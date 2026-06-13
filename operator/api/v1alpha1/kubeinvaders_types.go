package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// IngressSpec configures the optional Ingress for the KubeInvaders UI.
type IngressSpec struct {
	// Enabled creates an Ingress for the KubeInvaders web UI.
	// +optional
	Enabled bool `json:"enabled,omitempty"`

	// Host is the hostname for the Ingress rule (e.g. kubeinvaders.example.com).
	// +optional
	Host string `json:"host,omitempty"`

	// IngressClassName is the name of the IngressClass to use.
	// +optional
	IngressClassName *string `json:"ingressClassName,omitempty"`

	// Annotations are extra annotations added to the Ingress.
	// +optional
	Annotations map[string]string `json:"annotations,omitempty"`

	// TLSSecretName enables TLS on the Ingress using the given Secret.
	// +optional
	TLSSecretName string `json:"tlsSecretName,omitempty"`
}

// DemoSpec configures automatic demo workloads in the target namespaces, so a
// freshly created KubeInvaders instance has aliens to shoot without any manual
// setup.
type DemoSpec struct {
	// Enabled creates each target namespace (if missing) and deploys a demo
	// "aliens" workload in it. Namespaces created this way are deleted again
	// when the KubeInvaders resource is deleted; pre-existing namespaces are
	// left untouched.
	// +optional
	Enabled bool `json:"enabled,omitempty"`

	// Replicas is the number of pods per demo deployment.
	// +kubebuilder:default=8
	// +kubebuilder:validation:Minimum=1
	// +optional
	Replicas *int32 `json:"replicas,omitempty"`

	// Image is the demo workload image. The default is the Kubernetes pause
	// container: the smallest possible pod (~1MiB), so large waves cost
	// almost nothing.
	// +kubebuilder:default="registry.k8s.io/pause:3.10"
	// +optional
	Image string `json:"image,omitempty"`
}

// RouteSpec configures an OpenShift Route for the KubeInvaders UI.
// Ignored (with a status condition) on clusters without the Route API.
type RouteSpec struct {
	// Enabled creates an OpenShift Route for the KubeInvaders web UI.
	// +optional
	Enabled bool `json:"enabled,omitempty"`

	// Host is the route hostname. Leave empty to let OpenShift generate one.
	// +optional
	Host string `json:"host,omitempty"`

	// TLS enables edge TLS termination on the Route.
	// +optional
	TLS bool `json:"tls,omitempty"`
}

// KubeInvadersSpec defines the desired state of KubeInvaders.
type KubeInvadersSpec struct {
	// TargetNamespaces are the namespaces where KubeInvaders performs chaos
	// experiments (i.e. where the aliens are pods you can shoot down).
	// +kubebuilder:validation:MinItems=1
	// +kubebuilder:validation:Required
	// +operator-sdk:csv:customresourcedefinitions:type=spec,order=1,displayName="Target Namespaces"
	TargetNamespaces []string `json:"targetNamespaces"`

	// Image is the KubeInvaders container image.
	// +kubebuilder:default="docker.io/luckysideburn/kubeinvaders:latest"
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,order=2,displayName="Image"
	Image string `json:"image,omitempty"`

	// Replicas is the number of KubeInvaders pods.
	// +kubebuilder:default=1
	// +kubebuilder:validation:Minimum=0
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,order=3,displayName="Replicas",xDescriptors={"urn:alm:descriptor:com.tectonic.ui:podCount"}
	Replicas *int32 `json:"replicas,omitempty"`

	// ServiceType is the type of the Service exposing the web UI.
	// +kubebuilder:validation:Enum=ClusterIP;NodePort;LoadBalancer
	// +kubebuilder:default=ClusterIP
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,displayName="Service Type"
	ServiceType corev1.ServiceType `json:"serviceType,omitempty"`

	// ApplicationURL is the externally visible URL of the game, exported as the
	// APPLICATION_URL environment variable. Defaults to the Ingress host when
	// the Ingress is enabled.
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,displayName="Application URL"
	ApplicationURL string `json:"applicationURL,omitempty"`

	// Demo automatically creates the target namespaces and demo workloads to
	// shoot at, so no manual setup is needed.
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,order=4,displayName="Demo Workloads"
	Demo DemoSpec `json:"demo,omitempty"`

	// Route configures an OpenShift Route for the web UI. The route host is
	// exported to the game as APPLICATION_URL automatically.
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,order=5,displayName="Route (OpenShift)"
	Route RouteSpec `json:"route,omitempty"`

	// Ingress configures the optional Ingress for the web UI (non-OpenShift
	// clusters; on OpenShift prefer route).
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,displayName="Ingress"
	Ingress IngressSpec `json:"ingress,omitempty"`

	// Resources are the compute resources for the KubeInvaders container.
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,displayName="Resources",xDescriptors={"urn:alm:descriptor:com.tectonic.ui:resourceRequirements"}
	Resources corev1.ResourceRequirements `json:"resources,omitempty"`

	// ExtraEnv are additional environment variables for the KubeInvaders
	// container (e.g. ALIENPROXIMITY, HITSLIMIT, UPDATETIME, DISABLE_TLS).
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,displayName="Extra Environment Variables"
	ExtraEnv []corev1.EnvVar `json:"extraEnv,omitempty"`

	// AdditionalLabels are extra labels merged onto the KubeInvaders Deployment
	// and its pods. Use this to integrate with label-driven tooling such as
	// dashboards, service meshes, or cost-allocation systems without the
	// operator stripping the labels on the next reconcile.
	//
	// Example:
	//   additionalLabels:
	//     dashboard.yamlwrangler.com/enabled: "true"
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,displayName="Additional Labels"
	AdditionalLabels map[string]string `json:"additionalLabels,omitempty"`

	// AdditionalAnnotations are extra annotations merged onto the KubeInvaders
	// Deployment and its pods.
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=spec,displayName="Additional Annotations"
	AdditionalAnnotations map[string]string `json:"additionalAnnotations,omitempty"`
}

// KubeInvadersStatus defines the observed state of KubeInvaders.
type KubeInvadersStatus struct {
	// ReadyReplicas is the number of ready KubeInvaders pods.
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=status,displayName="Ready Replicas"
	ReadyReplicas int32 `json:"readyReplicas,omitempty"`

	// Conditions represent the latest available observations of the state.
	// +optional
	// +operator-sdk:csv:customresourcedefinitions:type=status,displayName="Conditions",xDescriptors={"urn:alm:descriptor:io.kubernetes.conditions"}
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:path=kubeinvaders,scope=Namespaced
// +kubebuilder:printcolumn:name="Ready",type=integer,JSONPath=`.status.readyReplicas`
// +kubebuilder:printcolumn:name="Image",type=string,JSONPath=`.spec.image`,priority=1
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// KubeInvaders deploys the KubeInvaders chaos engineering game and points it
// at a set of target namespaces, where pods become aliens you can shoot down.
// +operator-sdk:csv:customresourcedefinitions:displayName="KubeInvaders"
// +operator-sdk:csv:customresourcedefinitions:resources={{Deployment,v1,""},{Service,v1,""},{ServiceAccount,v1,""},{Ingress,v1,""},{Route,v1,""},{Namespace,v1,""}}
type KubeInvaders struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   KubeInvadersSpec   `json:"spec,omitempty"`
	Status KubeInvadersStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// KubeInvadersList contains a list of KubeInvaders.
type KubeInvadersList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []KubeInvaders `json:"items"`
}

func init() {
	SchemeBuilder.Register(&KubeInvaders{}, &KubeInvadersList{})
}
