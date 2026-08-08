import { AbstractClient } from "../../../common/abstract_client";
import { ClientConfig } from "../../../common/interface";
import { StartPublishLiveStreamResponse, DeleteProjectRequest, BoundLicensesRequest, CreateCloudRecordingResponse, ModifyProjectSecModeResponse, StartPublishLiveStreamRequest, ModifyDeviceResponse, GetLicensesRequest, DescribePolicyResponse, BatchDeleteDevicesRequest, ModifyProjectSecModeRequest, DescribeDeviceInfoRequest, DescribeSessionStatisticsByIntervalResponse, GetLicenseStatResponse, DescribeRecentSessionListRequest, DescribeDeviceSessionDetailsResponse, DescribeProjectInfoRequest, ModifyPolicyRequest, DescribeDeviceInfoResponse, GetLicenseStatRequest, GetDurationDetailsResponse, DescribeProjectListResponse, ModifyProjectResponse, BatchDeletePolicyResponse, CreateCloudRecordingRequest, DescribePolicyRequest, ModifyPolicyResponse, DeleteCloudRecordingResponse, DescribeSessionStatisticsRequest, GetDurationDetailsRequest, BatchDeleteDevicesResponse, ModifyProjectRequest, DescribeRecentSessionListResponse, ModifyDeviceRequest, DescribeProjectListRequest, BatchDeletePolicyRequest, CreateProjectResponse, DescribeProjectInfoResponse, DescribeDeviceListResponse, StopPublishLiveStreamRequest, DeleteCloudRecordingRequest, DeleteProjectResponse, DescribeDeviceListRequest, GetTotalDurationResponse, GetDeviceLicenseResponse, CreateDeviceResponse, DescribeSessionStatisticsByIntervalRequest, CreateDeviceRequest, StopPublishLiveStreamResponse, DescribeSessionStatisticsResponse, GetDevicesResponse, BoundLicensesResponse, DescribeDeviceSessionDetailsRequest, GetLicensesResponse, DescribeDeviceSessionListRequest, ModifyCallbackUrlRequest, GetDevicesRequest, GetTotalDurationRequest, DescribeDeviceSessionListResponse, ModifyCallbackUrlResponse, GetDeviceLicenseRequest, CreateProjectRequest } from "./trro_models";
/**
 * trro client
 * @class
 */
export declare class Client extends AbstractClient {
    constructor(clientConfig: ClientConfig);
    /**
     * 查询该时间段、对应项目、设备的不同分辨率的通话时长汇总
     */
    GetTotalDuration(req: GetTotalDurationRequest, cb?: (error: string, rep: GetTotalDurationResponse) => void): Promise<GetTotalDurationResponse>;
    /**
     * 设置回调URL
录制回调事件内容参考：https://cloud.tencent.com/document/product/647/81113
转推回调事件内容参考：https://cloud.tencent.com/document/product/647/88552
     */
    ModifyCallbackUrl(req: ModifyCallbackUrlRequest, cb?: (error: string, rep: ModifyCallbackUrlResponse) => void): Promise<ModifyCallbackUrlResponse>;
    /**
     * 用于获取项目信息
     */
    DescribeProjectInfo(req: DescribeProjectInfoRequest, cb?: (error: string, rep: DescribeProjectInfoResponse) => void): Promise<DescribeProjectInfoResponse>;
    /**
     * 查询用户设备的授权绑定情况
     */
    GetDevices(req: GetDevicesRequest, cb?: (error: string, rep: GetDevicesResponse) => void): Promise<GetDevicesResponse>;
    /**
     * 停止指定的混流转推任务。如果没有调用 Stop 接口停止任务，所有参与混流转推的主播离开房间超过MaxIdleTime 设置的时间后，任务也会自动停止。
     */
    StopPublishLiveStream(req: StopPublishLiveStreamRequest, cb?: (error: string, rep: StopPublishLiveStreamResponse) => void): Promise<StopPublishLiveStreamResponse>;
    /**
     * 用于修改设备信息
     */
    ModifyDevice(req: ModifyDeviceRequest, cb?: (error: string, rep: ModifyDeviceResponse) => void): Promise<ModifyDeviceResponse>;
    /**
     * 用于查看权限配置
     */
    DescribePolicy(req: DescribePolicyRequest, cb?: (error: string, rep: DescribePolicyResponse) => void): Promise<DescribePolicyResponse>;
    /**
     * 统计license类型数量
     */
    GetLicenseStat(req?: GetLicenseStatRequest, cb?: (error: string, rep: GetLicenseStatResponse) => void): Promise<GetLicenseStatResponse>;
    /**
     * 获取各时间段的会话统计值
     */
    DescribeSessionStatisticsByInterval(req: DescribeSessionStatisticsByIntervalRequest, cb?: (error: string, rep: DescribeSessionStatisticsByIntervalResponse) => void): Promise<DescribeSessionStatisticsByIntervalResponse>;
    /**
     * 为推流设备绑定license，优先绑定到期时间最近的，到期时间相同优先绑定月包
     */
    BoundLicenses(req: BoundLicensesRequest, cb?: (error: string, rep: BoundLicensesResponse) => void): Promise<BoundLicensesResponse>;
    /**
     * 用于批量删除修改权限配置
     */
    BatchDeletePolicy(req: BatchDeletePolicyRequest, cb?: (error: string, rep: BatchDeletePolicyResponse) => void): Promise<BatchDeletePolicyResponse>;
    /**
     * 启动一个混流转推任务，将 TRTC 房间的多路音视频流混成一路音视频流，编码后推到直播 CDN 或者回推到 TRTC 房间。也支持不转码直接转推 TRTC 房间的单路流。启动成功后，会返回一个 SdkAppid 维度唯一的任务 Id（TaskId）。您需要保存该 TaskId，后续需要依赖此 TaskId 更新和结束任务。
     */
    StartPublishLiveStream(req: StartPublishLiveStreamRequest, cb?: (error: string, rep: StartPublishLiveStreamResponse) => void): Promise<StartPublishLiveStreamResponse>;
    /**
     * 按授权查看license列表
     */
    GetLicenses(req: GetLicensesRequest, cb?: (error: string, rep: GetLicensesResponse) => void): Promise<GetLicensesResponse>;
    /**
     * 启动云端录制功能，完成房间内的音视频录制，并上传到指定的云存储。
     */
    CreateCloudRecording(req: CreateCloudRecordingRequest, cb?: (error: string, rep: CreateCloudRecordingResponse) => void): Promise<CreateCloudRecordingResponse>;
    /**
     * 用于获取设备信息列表
     */
    DescribeDeviceList(req: DescribeDeviceListRequest, cb?: (error: string, rep: DescribeDeviceListResponse) => void): Promise<DescribeDeviceListResponse>;
    /**
     * 用于修改项目信息
     */
    ModifyProject(req: ModifyProjectRequest, cb?: (error: string, rep: ModifyProjectResponse) => void): Promise<ModifyProjectResponse>;
    /**
     * 获取设备会话数据详单
     */
    DescribeDeviceSessionDetails(req: DescribeDeviceSessionDetailsRequest, cb?: (error: string, rep: DescribeDeviceSessionDetailsResponse) => void): Promise<DescribeDeviceSessionDetailsResponse>;
    /**
     * 用于修改权限配置
     */
    ModifyPolicy(req: ModifyPolicyRequest, cb?: (error: string, rep: ModifyPolicyResponse) => void): Promise<ModifyPolicyResponse>;
    /**
     * 查询该时间段、对应项目、设备的不同分辨率的通话时长流水，流水以日期（天）为单位
     */
    GetDurationDetails(req: GetDurationDetailsRequest, cb?: (error: string, rep: GetDurationDetailsResponse) => void): Promise<GetDurationDetailsResponse>;
    /**
     * 用于创建设备
     */
    CreateDevice(req: CreateDeviceRequest, cb?: (error: string, rep: CreateDeviceResponse) => void): Promise<CreateDeviceResponse>;
    /**
     * 用于批量删除设备
     */
    BatchDeleteDevices(req: BatchDeleteDevicesRequest, cb?: (error: string, rep: BatchDeleteDevicesResponse) => void): Promise<BatchDeleteDevicesResponse>;
    /**
     * 获取会话统计值
     */
    DescribeSessionStatistics(req: DescribeSessionStatisticsRequest, cb?: (error: string, rep: DescribeSessionStatisticsResponse) => void): Promise<DescribeSessionStatisticsResponse>;
    /**
     * 用于获取指定设备信息
     */
    DescribeDeviceInfo(req: DescribeDeviceInfoRequest, cb?: (error: string, rep: DescribeDeviceInfoResponse) => void): Promise<DescribeDeviceInfoResponse>;
    /**
     * 使用项目共享密钥可动态生成设备登录密钥，登录前无需对设备进行提前注册，适合希望简化业务流程的客户。由于是公共密钥，请务必注意保护项目共享密钥，并及时更新。建议项目共享密钥保存在服务器侧。由服务器生成设备登录密码下发给设备，避免密钥保存在客户端侧产生的密钥泄露风险。

开启项目共享密钥后，对于已注册的设备，仍可使用原设备密码登录。若希望仅能通过共享密钥生成密码登录，请通过云 API 将设备密码更新为"USEPROJECTKEYPWD"。
     */
    ModifyProjectSecMode(req: ModifyProjectSecModeRequest, cb?: (error: string, rep: ModifyProjectSecModeResponse) => void): Promise<ModifyProjectSecModeResponse>;
    /**
     * 获取设备会话列表
     */
    DescribeDeviceSessionList(req: DescribeDeviceSessionListRequest, cb?: (error: string, rep: DescribeDeviceSessionListResponse) => void): Promise<DescribeDeviceSessionListResponse>;
    /**
     * 成功开启录制后，可以使用此接口来停止录制任务。停止录制成功后不代表文件全部传输完成，如果未完成后台将会继续上传文件，成功后通过事件回调通知客户文件全部传输完成状态。
     */
    DeleteCloudRecording(req: DeleteCloudRecordingRequest, cb?: (error: string, rep: DeleteCloudRecordingResponse) => void): Promise<DeleteCloudRecordingResponse>;
    /**
     * 用于创建项目
     */
    CreateProject(req: CreateProjectRequest, cb?: (error: string, rep: CreateProjectResponse) => void): Promise<CreateProjectResponse>;
    /**
     * 获取最新设备会话列表
     */
    DescribeRecentSessionList(req: DescribeRecentSessionListRequest, cb?: (error: string, rep: DescribeRecentSessionListResponse) => void): Promise<DescribeRecentSessionListResponse>;
    /**
     * 获取设备已经绑定的可用授权数量
     */
    GetDeviceLicense(req: GetDeviceLicenseRequest, cb?: (error: string, rep: GetDeviceLicenseResponse) => void): Promise<GetDeviceLicenseResponse>;
    /**
     * 用于删除项目
     */
    DeleteProject(req: DeleteProjectRequest, cb?: (error: string, rep: DeleteProjectResponse) => void): Promise<DeleteProjectResponse>;
    /**
     * 用于获取项目列表
     */
    DescribeProjectList(req: DescribeProjectListRequest, cb?: (error: string, rep: DescribeProjectListResponse) => void): Promise<DescribeProjectListResponse>;
}
