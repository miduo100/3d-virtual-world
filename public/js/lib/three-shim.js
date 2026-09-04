/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * three-shim.js — 桥接全局 UMD THREE 与 ESM 模块（FBXLoader / postprocessing 等）
 *
 * 通过 import map 将裸说明符 'three' 指向本模块，使 examples/jsm 与第三方 ESM 库
 * （postprocessing 6.39.x）复用页面已有的全局 THREE 实例（r185 bundle），
 * 避免「双 THREE 实例」导致的 instanceof 失效 / clip 与 mixer 不兼容问题。
 *
 * 导出清单 = 以下三方并集（scripts/_gen_shim_check.js 校验全部存在于 r185 bundle）：
 *  1. three@0.185.1 examples/jsm/loaders/FBXLoader.js
 *  2. three@0.185.1 examples/jsm/curves/NURBSCurve.js + NURBSUtils.js（Curve/Vector3/Vector4）
 *  3. postprocessing@6.39.4（peer: three >=0.168 <0.186，匹配 r185）
 *
 * 维护规则：升级 three 或 postprocessing 后，用脚本重新 diff 三方 import 符号并更新本清单。
 */
const THREE = window.THREE;
if (!THREE || !THREE.REVISION) {
  throw new Error('[three-shim] window.THREE 未初始化：必须先加载 js/lib/three.min.js（r185 bundle）再 import 本模块');
}

export const AlwaysDepth = THREE.AlwaysDepth;
export const AmbientLight = THREE.AmbientLight;
export const AnimationClip = THREE.AnimationClip;
export const BackSide = THREE.BackSide;
export const BasicDepthPacking = THREE.BasicDepthPacking;
export const Bone = THREE.Bone;
export const BufferAttribute = THREE.BufferAttribute;
export const BufferGeometry = THREE.BufferGeometry;
export const CanvasTexture = THREE.CanvasTexture;
export const ClampToEdgeWrapping = THREE.ClampToEdgeWrapping;
export const Color = THREE.Color;
export const ColorManagement = THREE.ColorManagement;
export const Curve = THREE.Curve;
export const Data3DTexture = THREE.Data3DTexture;
export const DataTexture = THREE.DataTexture;
export const DepthStencilFormat = THREE.DepthStencilFormat;
export const DepthTexture = THREE.DepthTexture;
export const DirectionalLight = THREE.DirectionalLight;
export const DoubleSide = THREE.DoubleSide;
export const EqualDepth = THREE.EqualDepth;
export const EquirectangularReflectionMapping = THREE.EquirectangularReflectionMapping;
export const Euler = THREE.Euler;
export const EventDispatcher = THREE.EventDispatcher;
export const FileLoader = THREE.FileLoader;
export const Float32BufferAttribute = THREE.Float32BufferAttribute;
export const FloatType = THREE.FloatType;
export const FrontSide = THREE.FrontSide;
export const GreaterDepth = THREE.GreaterDepth;
export const GreaterEqualDepth = THREE.GreaterEqualDepth;
export const Group = THREE.Group;
export const HalfFloatType = THREE.HalfFloatType;
export const LessDepth = THREE.LessDepth;
export const LessEqualDepth = THREE.LessEqualDepth;
export const Line = THREE.Line;
export const LineBasicMaterial = THREE.LineBasicMaterial;
export const LinearFilter = THREE.LinearFilter;
export const LinearMipmapLinearFilter = THREE.LinearMipmapLinearFilter;
export const LinearSRGBColorSpace = THREE.LinearSRGBColorSpace;
export const Loader = THREE.Loader;
export const LoaderUtils = THREE.LoaderUtils;
export const LoadingManager = THREE.LoadingManager;
export const Material = THREE.Material;
export const MathUtils = THREE.MathUtils;
export const Matrix3 = THREE.Matrix3;
export const Matrix4 = THREE.Matrix4;
export const Mesh = THREE.Mesh;
export const MeshDepthMaterial = THREE.MeshDepthMaterial;
export const MeshLambertMaterial = THREE.MeshLambertMaterial;
export const MeshNormalMaterial = THREE.MeshNormalMaterial;
export const MeshPhongMaterial = THREE.MeshPhongMaterial;
export const NearestFilter = THREE.NearestFilter;
export const NeverDepth = THREE.NeverDepth;
export const NoBlending = THREE.NoBlending;
export const NoColorSpace = THREE.NoColorSpace;
export const NotEqualDepth = THREE.NotEqualDepth;
export const NumberKeyframeTrack = THREE.NumberKeyframeTrack;
export const Object3D = THREE.Object3D;
export const OrthographicCamera = THREE.OrthographicCamera;
export const PerspectiveCamera = THREE.PerspectiveCamera;
export const PointLight = THREE.PointLight;
export const PropertyBinding = THREE.PropertyBinding;
export const Quaternion = THREE.Quaternion;
export const QuaternionKeyframeTrack = THREE.QuaternionKeyframeTrack;
export const REVISION = THREE.REVISION;
export const RGBADepthPacking = THREE.RGBADepthPacking;
export const RGBAFormat = THREE.RGBAFormat;
export const RGFormat = THREE.RGFormat;
export const RedFormat = THREE.RedFormat;
export const RepeatWrapping = THREE.RepeatWrapping;
export const SRGBColorSpace = THREE.SRGBColorSpace;
export const Scene = THREE.Scene;
export const ShaderMaterial = THREE.ShaderMaterial;
export const ShapeUtils = THREE.ShapeUtils;
export const Skeleton = THREE.Skeleton;
export const SkinnedMesh = THREE.SkinnedMesh;
export const SpotLight = THREE.SpotLight;
export const Texture = THREE.Texture;
export const TextureLoader = THREE.TextureLoader;
export const Uint16BufferAttribute = THREE.Uint16BufferAttribute;
export const Uniform = THREE.Uniform;
export const UnsignedByteType = THREE.UnsignedByteType;
export const UnsignedInt248Type = THREE.UnsignedInt248Type;
export const Vector2 = THREE.Vector2;
export const Vector3 = THREE.Vector3;
export const Vector4 = THREE.Vector4;
export const VectorKeyframeTrack = THREE.VectorKeyframeTrack;
export const WebGLRenderTarget = THREE.WebGLRenderTarget;

export default THREE;
