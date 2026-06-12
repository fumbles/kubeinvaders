package controller

import (
	"context"
	"fmt"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	logf "sigs.k8s.io/controller-runtime/pkg/log"

	gamev1alpha1 "github.com/lucky-sideburn/kubeinvaders/operator/api/v1alpha1"
)

const (
	finalizerName  = "game.kubeinvaders.io/finalizer"
	httpPort       = 8080
	createdByLabel = "game.kubeinvaders.io/created-by"
	demoDeployName = "kubeinvaders-aliens"
)

var routeGVK = schema.GroupVersionKind{Group: "route.openshift.io", Version: "v1", Kind: "Route"}

// KubeInvadersReconciler reconciles a KubeInvaders object.
type KubeInvadersReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

// Permissions to manage the KubeInvaders custom resource and the objects it owns:
// +kubebuilder:rbac:groups=game.kubeinvaders.io,resources=kubeinvaders,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=game.kubeinvaders.io,resources=kubeinvaders/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=game.kubeinvaders.io,resources=kubeinvaders/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=services;serviceaccounts,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=networking.k8s.io,resources=ingresses,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=clusterroles;clusterrolebindings,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=route.openshift.io,resources=routes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=namespaces,verbs=get;list;watch;create;delete
//
// Permissions the operator grants to the KubeInvaders game ServiceAccount
// (Kubernetes RBAC requires the granter to hold these permissions too):
// +kubebuilder:rbac:groups="",resources=pods;pods/log,verbs=get;list;watch;delete
// +kubebuilder:rbac:groups=batch;extensions,resources=jobs,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=*,resources=*,verbs=get;list;watch
// +kubebuilder:rbac:groups=subresources.kubevirt.io,resources=virtualmachines/restart,verbs=update

// Reconcile brings the cluster to the state described by a KubeInvaders object:
// a Deployment running the game, a Service (and optional Ingress) exposing it,
// and a ServiceAccount with the RBAC needed to run chaos experiments against
// the target namespaces.
func (r *KubeInvadersReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx)

	kinv := &gamev1alpha1.KubeInvaders{}
	if err := r.Get(ctx, req.NamespacedName, kinv); err != nil {
		if apierrors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	// Handle deletion: clean up resources that cannot have an owner reference
	// (cluster-scoped RBAC, demo resources in other namespaces).
	if !kinv.DeletionTimestamp.IsZero() {
		if controllerutil.ContainsFinalizer(kinv, finalizerName) {
			if err := r.deleteClusterRBAC(ctx, kinv); err != nil {
				return ctrl.Result{}, err
			}
			if err := r.deleteDemoResources(ctx, kinv); err != nil {
				return ctrl.Result{}, err
			}
			controllerutil.RemoveFinalizer(kinv, finalizerName)
			if err := r.Update(ctx, kinv); err != nil {
				return ctrl.Result{}, err
			}
		}
		return ctrl.Result{}, nil
	}

	if !controllerutil.ContainsFinalizer(kinv, finalizerName) {
		controllerutil.AddFinalizer(kinv, finalizerName)
		if err := r.Update(ctx, kinv); err != nil {
			return ctrl.Result{}, err
		}
	}

	for _, reconcileFn := range []func(context.Context, *gamev1alpha1.KubeInvaders) error{
		r.reconcileServiceAccount,
		r.reconcileClusterRBAC,
		r.reconcileDemo,
		r.reconcileService,
		r.reconcileIngress,
	} {
		if err := reconcileFn(ctx, kinv); err != nil {
			return ctrl.Result{}, err
		}
	}

	routeHost, err := r.reconcileRoute(ctx, kinv)
	if err != nil {
		return ctrl.Result{}, err
	}

	if err := r.reconcileDeployment(ctx, kinv, routeHost); err != nil {
		return ctrl.Result{}, err
	}

	if err := r.updateStatus(ctx, kinv); err != nil {
		return ctrl.Result{}, err
	}

	log.Info("reconciled KubeInvaders", "name", kinv.Name, "namespace", kinv.Namespace)

	// The route host is assigned asynchronously by the OpenShift router;
	// requeue until we know it so APPLICATION_URL can be set.
	if kinv.Spec.Route.Enabled && kinv.Spec.ApplicationURL == "" && routeHost == "" {
		return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
	}
	return ctrl.Result{}, nil
}

func labelsFor(kinv *gamev1alpha1.KubeInvaders) map[string]string {
	return map[string]string{
		"app.kubernetes.io/name":       "kubeinvaders",
		"app.kubernetes.io/instance":   kinv.Name,
		"app.kubernetes.io/managed-by": "kubeinvaders-operator",
	}
}

// clusterRBACName returns a cluster-unique name for the ClusterRole and
// ClusterRoleBinding belonging to a KubeInvaders instance.
func clusterRBACName(kinv *gamev1alpha1.KubeInvaders) string {
	return fmt.Sprintf("kubeinvaders-%s-%s", kinv.Namespace, kinv.Name)
}

func (r *KubeInvadersReconciler) reconcileServiceAccount(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: kinv.Name, Namespace: kinv.Namespace},
	}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, sa, func() error {
		sa.Labels = labelsFor(kinv)
		return ctrl.SetControllerReference(kinv, sa, r.Scheme)
	})
	return err
}

func (r *KubeInvadersReconciler) reconcileClusterRBAC(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	name := clusterRBACName(kinv)

	clusterRole := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: name},
	}
	if _, err := controllerutil.CreateOrUpdate(ctx, r.Client, clusterRole, func() error {
		clusterRole.Labels = labelsFor(kinv)
		clusterRole.Rules = []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"pods", "pods/log"},
				Verbs:     []string{"get", "list", "watch", "delete"},
			},
			{
				APIGroups: []string{"batch", "extensions"},
				Resources: []string{"jobs"},
				Verbs:     []string{"get", "list", "watch", "create", "update", "patch", "delete"},
			},
			{
				APIGroups: []string{"*"},
				Resources: []string{"*"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{"kubevirt.io"},
				Resources: []string{"virtualmachines", "virtualmachineinstances"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{"subresources.kubevirt.io"},
				Resources: []string{"virtualmachines/restart"},
				Verbs:     []string{"update"},
			},
		}
		return nil
	}); err != nil {
		return err
	}

	binding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: name},
	}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, binding, func() error {
		binding.Labels = labelsFor(kinv)
		binding.Subjects = []rbacv1.Subject{
			{
				Kind:      rbacv1.ServiceAccountKind,
				Name:      kinv.Name,
				Namespace: kinv.Namespace,
			},
		}
		binding.RoleRef = rbacv1.RoleRef{
			APIGroup: rbacv1.GroupName,
			Kind:     "ClusterRole",
			Name:     name,
		}
		return nil
	})
	return err
}

func (r *KubeInvadersReconciler) deleteClusterRBAC(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	name := clusterRBACName(kinv)
	binding := &rbacv1.ClusterRoleBinding{ObjectMeta: metav1.ObjectMeta{Name: name}}
	if err := r.Delete(ctx, binding); err != nil && !apierrors.IsNotFound(err) {
		return err
	}
	clusterRole := &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: name}}
	if err := r.Delete(ctx, clusterRole); err != nil && !apierrors.IsNotFound(err) {
		return err
	}
	return nil
}

func (r *KubeInvadersReconciler) applicationURL(kinv *gamev1alpha1.KubeInvaders, routeHost string) string {
	if kinv.Spec.ApplicationURL != "" {
		return kinv.Spec.ApplicationURL
	}
	if routeHost != "" {
		return routeHost
	}
	if kinv.Spec.Ingress.Enabled && kinv.Spec.Ingress.Host != "" {
		return kinv.Spec.Ingress.Host
	}
	return fmt.Sprintf("%s.%s.svc.cluster.local:%d", kinv.Name, kinv.Namespace, httpPort)
}

// reconcileDemo ensures each target namespace exists and contains a demo
// "aliens" deployment, so the game has pods to shoot at out of the box.
// Namespaces created here are labeled so they (and only they) are deleted
// when the KubeInvaders resource is deleted.
func (r *KubeInvadersReconciler) reconcileDemo(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	if !kinv.Spec.Demo.Enabled {
		return nil
	}

	replicas := int32(8)
	if kinv.Spec.Demo.Replicas != nil {
		replicas = *kinv.Spec.Demo.Replicas
	}
	image := kinv.Spec.Demo.Image
	if image == "" {
		image = "docker.io/nginxinc/nginx-unprivileged:stable"
	}

	for _, nsName := range kinv.Spec.TargetNamespaces {
		ns := &corev1.Namespace{}
		if err := r.Get(ctx, types.NamespacedName{Name: nsName}, ns); err != nil {
			if !apierrors.IsNotFound(err) {
				return err
			}
			ns = &corev1.Namespace{
				ObjectMeta: metav1.ObjectMeta{
					Name:   nsName,
					Labels: map[string]string{createdByLabel: ownerID(kinv)},
				},
			}
			if err := r.Create(ctx, ns); err != nil && !apierrors.IsAlreadyExists(err) {
				return err
			}
		}

		labels := map[string]string{
			"app.kubernetes.io/name":       demoDeployName,
			"app.kubernetes.io/managed-by": "kubeinvaders-operator",
			createdByLabel:                 ownerID(kinv),
		}
		deploy := &appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: demoDeployName, Namespace: nsName},
		}
		if _, err := controllerutil.CreateOrUpdate(ctx, r.Client, deploy, func() error {
			deploy.Labels = labels
			deploy.Spec.Replicas = &replicas
			if deploy.Spec.Selector == nil {
				deploy.Spec.Selector = &metav1.LabelSelector{
					MatchLabels: map[string]string{"app.kubernetes.io/name": demoDeployName},
				}
			}
			deploy.Spec.Template.Labels = map[string]string{"app.kubernetes.io/name": demoDeployName}
			deploy.Spec.Template.Spec.Containers = []corev1.Container{
				{
					Name:  "alien",
					Image: image,
					Ports: []corev1.ContainerPort{{ContainerPort: 8080, Protocol: corev1.ProtocolTCP}},
				},
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}

// deleteDemoResources removes demo deployments and any namespaces this CR created.
func (r *KubeInvadersReconciler) deleteDemoResources(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	for _, nsName := range kinv.Spec.TargetNamespaces {
		ns := &corev1.Namespace{}
		if err := r.Get(ctx, types.NamespacedName{Name: nsName}, ns); err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return err
		}
		if ns.Labels[createdByLabel] == ownerID(kinv) {
			// We created the whole namespace: deleting it removes the demo
			// deployment with it.
			if err := r.Delete(ctx, ns); err != nil && !apierrors.IsNotFound(err) {
				return err
			}
			continue
		}
		// Pre-existing namespace: only remove our demo deployment, if any.
		deploy := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: demoDeployName, Namespace: nsName}}
		if err := r.Get(ctx, types.NamespacedName{Name: demoDeployName, Namespace: nsName}, deploy); err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return err
		}
		if deploy.Labels[createdByLabel] == ownerID(kinv) {
			if err := r.Delete(ctx, deploy); err != nil && !apierrors.IsNotFound(err) {
				return err
			}
		}
	}
	return nil
}

// reconcileRoute manages an OpenShift Route (via unstructured, so the operator
// has no hard dependency on OpenShift APIs) and returns the assigned host.
// On clusters without the Route API it records a condition and returns "".
func (r *KubeInvadersReconciler) reconcileRoute(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) (string, error) {
	route := &unstructured.Unstructured{}
	route.SetGroupVersionKind(routeGVK)
	route.SetName(kinv.Name)
	route.SetNamespace(kinv.Namespace)

	if !kinv.Spec.Route.Enabled {
		err := r.Delete(ctx, route)
		if err != nil && !apierrors.IsNotFound(err) && !meta.IsNoMatchError(err) {
			return "", err
		}
		return "", nil
	}

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, route, func() error {
		route.SetLabels(labelsFor(kinv))
		spec := map[string]interface{}{
			"to": map[string]interface{}{
				"kind": "Service",
				"name": kinv.Name,
			},
			"port": map[string]interface{}{
				"targetPort": "http",
			},
		}
		if kinv.Spec.Route.Host != "" {
			spec["host"] = kinv.Spec.Route.Host
		}
		if kinv.Spec.Route.TLS {
			spec["tls"] = map[string]interface{}{
				"termination":                   "edge",
				"insecureEdgeTerminationPolicy": "Redirect",
			}
		}
		if err := unstructured.SetNestedMap(route.Object, spec, "spec"); err != nil {
			return err
		}
		return ctrl.SetControllerReference(kinv, route, r.Scheme)
	})
	if meta.IsNoMatchError(err) {
		meta.SetStatusCondition(&kinv.Status.Conditions, metav1.Condition{
			Type:    "RouteAvailable",
			Status:  metav1.ConditionFalse,
			Reason:  "RouteAPINotFound",
			Message: "spec.route.enabled is set but this cluster has no route.openshift.io API; use spec.ingress instead",
		})
		return "", nil
	}
	if err != nil {
		return "", err
	}

	// Prefer the spec host (set explicitly or defaulted by OpenShift), fall
	// back to the admitted host in status.
	if host, found, _ := unstructured.NestedString(route.Object, "spec", "host"); found && host != "" {
		return host, nil
	}
	ingresses, found, _ := unstructured.NestedSlice(route.Object, "status", "ingress")
	if found && len(ingresses) > 0 {
		if first, ok := ingresses[0].(map[string]interface{}); ok {
			if host, ok := first["host"].(string); ok {
				return host, nil
			}
		}
	}
	return "", nil
}

func ownerID(kinv *gamev1alpha1.KubeInvaders) string {
	return fmt.Sprintf("%s.%s", kinv.Namespace, kinv.Name)
}

func (r *KubeInvadersReconciler) reconcileDeployment(ctx context.Context, kinv *gamev1alpha1.KubeInvaders, routeHost string) error {
	labels := labelsFor(kinv)

	image := kinv.Spec.Image
	if image == "" {
		image = "docker.io/luckysideburn/kubeinvaders:latest"
	}

	env := []corev1.EnvVar{
		{Name: "NAMESPACE", Value: strings.Join(kinv.Spec.TargetNamespaces, ",")},
		{Name: "APPLICATION_URL", Value: r.applicationURL(kinv, routeHost)},
		{Name: "REDIS_HOST", Value: "127.0.0.1"},
		{Name: "DISABLE_TLS", Value: "true"},
	}
	env = append(env, kinv.Spec.ExtraEnv...)

	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: kinv.Name, Namespace: kinv.Namespace},
	}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, deploy, func() error {
		deploy.Labels = labels
		deploy.Spec.Replicas = kinv.Spec.Replicas
		if deploy.Spec.Selector == nil {
			deploy.Spec.Selector = &metav1.LabelSelector{MatchLabels: labels}
		}
		deploy.Spec.Template.Labels = labels
		deploy.Spec.Template.Spec.ServiceAccountName = kinv.Name
		container := corev1.Container{
			Name:            "kubeinvaders",
			Image:           image,
			ImagePullPolicy: corev1.PullAlways,
			Env:             env,
			Ports: []corev1.ContainerPort{
				{Name: "http", ContainerPort: httpPort, Protocol: corev1.ProtocolTCP},
			},
			Resources: kinv.Spec.Resources,
			ReadinessProbe: &corev1.Probe{
				ProbeHandler: corev1.ProbeHandler{
					TCPSocket: &corev1.TCPSocketAction{Port: intstr.FromInt32(httpPort)},
				},
				InitialDelaySeconds: 5,
				PeriodSeconds:       10,
			},
			LivenessProbe: &corev1.Probe{
				ProbeHandler: corev1.ProbeHandler{
					TCPSocket: &corev1.TCPSocketAction{Port: intstr.FromInt32(httpPort)},
				},
				InitialDelaySeconds: 15,
				PeriodSeconds:       20,
			},
		}
		deploy.Spec.Template.Spec.Containers = []corev1.Container{container}
		return ctrl.SetControllerReference(kinv, deploy, r.Scheme)
	})
	return err
}

func (r *KubeInvadersReconciler) reconcileService(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: kinv.Name, Namespace: kinv.Namespace},
	}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, svc, func() error {
		svc.Labels = labelsFor(kinv)
		svc.Spec.Selector = labelsFor(kinv)
		svc.Spec.Type = kinv.Spec.ServiceType
		if svc.Spec.Type == "" {
			svc.Spec.Type = corev1.ServiceTypeClusterIP
		}
		svc.Spec.Ports = []corev1.ServicePort{
			{
				Name:       "http",
				Port:       httpPort,
				TargetPort: intstr.FromString("http"),
				Protocol:   corev1.ProtocolTCP,
			},
		}
		return ctrl.SetControllerReference(kinv, svc, r.Scheme)
	})
	return err
}

func (r *KubeInvadersReconciler) reconcileIngress(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: kinv.Name, Namespace: kinv.Namespace},
	}

	if !kinv.Spec.Ingress.Enabled {
		err := r.Get(ctx, types.NamespacedName{Name: kinv.Name, Namespace: kinv.Namespace}, ingress)
		if apierrors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		return client.IgnoreNotFound(r.Delete(ctx, ingress))
	}

	pathType := networkingv1.PathTypePrefix
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, ingress, func() error {
		ingress.Labels = labelsFor(kinv)
		ingress.Annotations = kinv.Spec.Ingress.Annotations
		ingress.Spec.IngressClassName = kinv.Spec.Ingress.IngressClassName
		ingress.Spec.Rules = []networkingv1.IngressRule{
			{
				Host: kinv.Spec.Ingress.Host,
				IngressRuleValue: networkingv1.IngressRuleValue{
					HTTP: &networkingv1.HTTPIngressRuleValue{
						Paths: []networkingv1.HTTPIngressPath{
							{
								Path:     "/",
								PathType: &pathType,
								Backend: networkingv1.IngressBackend{
									Service: &networkingv1.IngressServiceBackend{
										Name: kinv.Name,
										Port: networkingv1.ServiceBackendPort{Name: "http"},
									},
								},
							},
						},
					},
				},
			},
		}
		if kinv.Spec.Ingress.TLSSecretName != "" {
			ingress.Spec.TLS = []networkingv1.IngressTLS{
				{
					Hosts:      []string{kinv.Spec.Ingress.Host},
					SecretName: kinv.Spec.Ingress.TLSSecretName,
				},
			}
		} else {
			ingress.Spec.TLS = nil
		}
		return ctrl.SetControllerReference(kinv, ingress, r.Scheme)
	})
	return err
}

func (r *KubeInvadersReconciler) updateStatus(ctx context.Context, kinv *gamev1alpha1.KubeInvaders) error {
	deploy := &appsv1.Deployment{}
	readyReplicas := int32(0)
	if err := r.Get(ctx, types.NamespacedName{Name: kinv.Name, Namespace: kinv.Namespace}, deploy); err == nil {
		readyReplicas = deploy.Status.ReadyReplicas
	}

	kinv.Status.ReadyReplicas = readyReplicas

	condition := metav1.Condition{
		Type:    "Available",
		Status:  metav1.ConditionFalse,
		Reason:  "DeploymentNotReady",
		Message: "KubeInvaders deployment has no ready replicas",
	}
	if readyReplicas > 0 {
		condition.Status = metav1.ConditionTrue
		condition.Reason = "DeploymentReady"
		condition.Message = fmt.Sprintf("KubeInvaders is ready with %d replica(s); insert coin to play", readyReplicas)
	}
	meta.SetStatusCondition(&kinv.Status.Conditions, condition)

	return r.Status().Update(ctx, kinv)
}

// SetupWithManager sets up the controller with the Manager.
func (r *KubeInvadersReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&gamev1alpha1.KubeInvaders{}).
		Owns(&appsv1.Deployment{}).
		Owns(&corev1.Service{}).
		Owns(&corev1.ServiceAccount{}).
		Owns(&networkingv1.Ingress{}).
		Named("kubeinvaders").
		Complete(r)
}
