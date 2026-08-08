/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * three-shim.js — 桥接全局 UMD THREE 与 ESM 加载器（FBXLoader 等）
 *
 * 通过 import map 将裸说明符 'three' 指向本模块，使 examples/jsm 下的
 * ESM 版 FBXLoader / NURBSCurve / NURBSUtils 复用页面已有的全局 THREE 实例，
 * 避免「双 THREE 实例」导致的动画 clip 与渲染器 mixer 不兼容问题。
 *
 * 覆盖 three@0.160.0 中 FBXLoader 及其依赖曲线所需全部命名导出。
 */
const THREE = window.THREE;

export const AmbientLight = THREE.AmbientLight;
export const AnimationClip = THREE.AnimationClip;
export const Bone = THREE.Bone;
export const BufferGeometry = THREE.BufferGeometry;
export const ClampToEdgeWrapping = THREE.ClampToEdgeWrapping;
export const Color = THREE.Color;
export const Curve = THREE.Curve;
export const DirectionalLight = THREE.DirectionalLight;
export const EquirectangularReflectionMapping = THREE.EquirectangularReflectionMapping;
export const Euler = THREE.Euler;
export const FileLoader = THREE.FileLoader;
export const Float32BufferAttribute = THREE.Float32BufferAttribute;
export const Group = THREE.Group;
export const Line = THREE.Line;
export const LineBasicMaterial = THREE.LineBasicMaterial;
export const Loader = THREE.Loader;
export const LoaderUtils = THREE.LoaderUtils;
export const MathUtils = THREE.MathUtils;
export const Matrix3 = THREE.Matrix3;
export const Matrix4 = THREE.Matrix4;
export const Mesh = THREE.Mesh;
export const MeshLambertMaterial = THREE.MeshLambertMaterial;
export const MeshPhongMaterial = THREE.MeshPhongMaterial;
export const NumberKeyframeTrack = THREE.NumberKeyframeTrack;
export const Object3D = THREE.Object3D;
export const OrthographicCamera = THREE.OrthographicCamera;
export const PerspectiveCamera = THREE.PerspectiveCamera;
export const PointLight = THREE.PointLight;
export const PropertyBinding = THREE.PropertyBinding;
export const Quaternion = THREE.Quaternion;
export const QuaternionKeyframeTrack = THREE.QuaternionKeyframeTrack;
export const RepeatWrapping = THREE.RepeatWrapping;
export const Skeleton = THREE.Skeleton;
export const SkinnedMesh = THREE.SkinnedMesh;
export const SpotLight = THREE.SpotLight;
export const Texture = THREE.Texture;
export const TextureLoader = THREE.TextureLoader;
export const Uint16BufferAttribute = THREE.Uint16BufferAttribute;
export const Vector2 = THREE.Vector2;
export const Vector3 = THREE.Vector3;
export const Vector4 = THREE.Vector4;
export const VectorKeyframeTrack = THREE.VectorKeyframeTrack;
export const SRGBColorSpace = THREE.SRGBColorSpace;
export const ShapeUtils = THREE.ShapeUtils;

export default THREE;
