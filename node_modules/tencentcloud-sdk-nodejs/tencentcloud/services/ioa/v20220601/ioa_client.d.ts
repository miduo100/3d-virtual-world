import { AbstractClient } from "../../../common/abstract_client";
import { ClientConfig } from "../../../common/interface";
import { CreatePrivilegeCodeRequest, DescribeDeviceDetailListResponse, DescribeAggrSoftDeviceListRequest, DescribeDeviceHardwareInfoListResponse, DescribeDevicesResponse, DescribeAccountGroupsRequest, DescribeDeviceVirtualGroupsResponse, DescribeAggrSoftCategorySoftListRequest, CreateDeviceVirtualGroupRequest, CreateDeviceTaskRequest, DescribeSoftCensusListByDeviceRequest, DescribeLocalAccountsRequest, CreateDeviceTaskResponse, CreateDLPFileDetectionTaskRequest, ExportDeviceDownloadTaskRequest, DescribeDeviceInfoRequest, DescribeDeviceVirtualGroupsRequest, DescribeDeviceChildGroupsRequest, DescribeDeviceInfoResponse, DescribeDLPEdgeNodesResponse, ExportSoftwareInformationListResponse, DescribeSoftwareInformationRequest, DescribeDLPFileDetectTaskResultResponse, CreateDLPFileDetectTaskResponse, DescribeDLPEdgeNodesRequest, DescribeAggrSoftDetailRequest, DescribeDLPEdgeNodeGroupsRequest, DescribeVirtualDevicesResponse, CreateDLPFileDetectTaskRequest, DescribeDLPFileDetectResultRequest, CreateDeviceVirtualGroupResponse, ExportDeviceDownloadTaskResponse, DescribeSoftwareInformationResponse, ModifyVirtualDeviceGroupsResponse, DescribeLocalAccountsResponse, DescribeAccountGroupsResponse, DescribeSoftCensusListByDeviceResponse, DescribeDLPEdgeNodeGroupsResponse, DescribeAggrSoftDeviceListResponse, DescribeRootAccountGroupResponse, DescribeDLPFileDetectTaskResultRequest, DescribeDeviceDetailListRequest, ExportSoftwareInformationListRequest, ModifyVirtualDeviceGroupsRequest, DescribeVirtualDevicesRequest, DescribeRootAccountGroupRequest, DescribeDevicesRequest, DescribeAggrSoftCategorySoftListResponse, DescribeAggrSoftDetailResponse, CreateDLPFileDetectionTaskResponse, DescribeDeviceChildGroupsResponse, DescribeDLPFileDetectResultResponse, CreatePrivilegeCodeResponse, DescribeDeviceHardwareInfoListRequest } from "./ioa_models";
/**
 * ioa client
 * @class
 */
export declare class Client extends AbstractClient {
    constructor(clientConfig: ClientConfig);
    /**
     * 聚合软件的已安装终端列表
     */
    DescribeAggrSoftDeviceList(req: DescribeAggrSoftDeviceListRequest, cb?: (error: string, rep: DescribeAggrSoftDeviceListResponse) => void): Promise<DescribeAggrSoftDeviceListResponse>;
    /**
     * 创建终端导出任务，私有化调用path为：capi/Assets/Device/ExportDeviceDownloadTask
     */
    ExportDeviceDownloadTask(req: ExportDeviceDownloadTaskRequest, cb?: (error: string, rep: ExportDeviceDownloadTaskResponse) => void): Promise<ExportDeviceDownloadTaskResponse>;
    /**
     * 创建获取终端进程网络服务信息任务，私有化调用path为：capi/Assets/Device/DescribeDeviceInfo
     */
    CreateDeviceTask(req: CreateDeviceTaskRequest, cb?: (error: string, rep: CreateDeviceTaskResponse) => void): Promise<CreateDeviceTaskResponse>;
    /**
     * 查看指定终端的软件详情列表,私有化调用path为：capi/Software/DescribeSoftwareInformation
     */
    DescribeSoftwareInformation(req: DescribeSoftwareInformationRequest, cb?: (error: string, rep: DescribeSoftwareInformationResponse) => void): Promise<DescribeSoftwareInformationResponse>;
    /**
     * 创建文件鉴定任务，私有化调用path为：capi/DlpOpenApi/CreateDLPFileDetectTask
     */
    CreateDLPFileDetectTask(req: CreateDLPFileDetectTaskRequest, cb?: (error: string, rep: CreateDLPFileDetectTaskResponse) => void): Promise<CreateDLPFileDetectTaskResponse>;
    /**
     * 创建终端自定义分组，私有化调用path为：/capi/Assets/Device/CreateDeviceVirtualGroup
     */
    CreateDeviceVirtualGroup(req: CreateDeviceVirtualGroupRequest, cb?: (error: string, rep: CreateDeviceVirtualGroupResponse) => void): Promise<CreateDeviceVirtualGroupResponse>;
    /**
     * 查询文件鉴定任务结果
     */
    DescribeDLPFileDetectTaskResult(req: DescribeDLPFileDetectTaskResultRequest, cb?: (error: string, rep: DescribeDLPFileDetectTaskResultResponse) => void): Promise<DescribeDLPFileDetectTaskResultResponse>;
    /**
     * 展示自定义分组终端列表，私有化调用path为：/capi/Assets/DescribeVirtualDevices
     */
    DescribeVirtualDevices(req: DescribeVirtualDevicesRequest, cb?: (error: string, rep: DescribeVirtualDevicesResponse) => void): Promise<DescribeVirtualDevicesResponse>;
    /**
     * 导出基于指定终端查看软件信息详情列表查询,私有化调用path为：capi/Software/ExportSoftwareInformationList
     */
    ExportSoftwareInformationList(req: ExportSoftwareInformationListRequest, cb?: (error: string, rep: ExportSoftwareInformationListResponse) => void): Promise<ExportSoftwareInformationListResponse>;
    /**
     * 提交送检任务
     */
    CreateDLPFileDetectionTask(req: CreateDLPFileDetectionTaskRequest, cb?: (error: string, rep: CreateDLPFileDetectionTaskResponse) => void): Promise<CreateDLPFileDetectionTaskResponse>;
    /**
     * 生成特权码，私有化调用path为：capi/Assets/Device/CreatePrivilegeCode，生成的特权码、卸载码，仅对该设备当天有效
     */
    CreatePrivilegeCode(req: CreatePrivilegeCodeRequest, cb?: (error: string, rep: CreatePrivilegeCodeResponse) => void): Promise<CreatePrivilegeCodeResponse>;
    /**
     * 查询账号根分组详情。对应“用户与授权管理”里内置不可见的全网根账号组，所有新建的目录，都挂在该全网根账号组下。
     */
    DescribeRootAccountGroup(req?: DescribeRootAccountGroupRequest, cb?: (error: string, rep: DescribeRootAccountGroupResponse) => void): Promise<DescribeRootAccountGroupResponse>;
    /**
     * webservice查询文件检测结果
     */
    DescribeDLPFileDetectResult(req: DescribeDLPFileDetectResultRequest, cb?: (error: string, rep: DescribeDLPFileDetectResultResponse) => void): Promise<DescribeDLPFileDetectResultResponse>;
    /**
     * 聚合的分类软件列表
     */
    DescribeAggrSoftCategorySoftList(req: DescribeAggrSoftCategorySoftListRequest, cb?: (error: string, rep: DescribeAggrSoftCategorySoftListResponse) => void): Promise<DescribeAggrSoftCategorySoftListResponse>;
    /**
     * 查询边缘节点列表，私有化调用path为：capi/DlpOpenApi/DescribeDLPEdgeNodes
     */
    DescribeDLPEdgeNodes(req: DescribeDLPEdgeNodesRequest, cb?: (error: string, rep: DescribeDLPEdgeNodesResponse) => void): Promise<DescribeDLPEdgeNodesResponse>;
    /**
     * 聚合的软件详情
     */
    DescribeAggrSoftDetail(req: DescribeAggrSoftDetailRequest, cb?: (error: string, rep: DescribeAggrSoftDetailResponse) => void): Promise<DescribeAggrSoftDetailResponse>;
    /**
     * 获取终端进程网络服务信息，私有化调用path为：capi/Assets/Device/DescribeDeviceInfo
     */
    DescribeDeviceInfo(req: DescribeDeviceInfoRequest, cb?: (error: string, rep: DescribeDeviceInfoResponse) => void): Promise<DescribeDeviceInfoResponse>;
    /**
     * 查询满足条件的查询终端硬件信息列表，私有化调用path为：/capi/Assets/Device/DescribeDeviceHardwareInfoList
     */
    DescribeDeviceHardwareInfoList(req: DescribeDeviceHardwareInfoListRequest, cb?: (error: string, rep: DescribeDeviceHardwareInfoListResponse) => void): Promise<DescribeDeviceHardwareInfoListResponse>;
    /**
     * 查询设备组子分组详情，私有化调用path为：capi/Assets/Device/DescribeDeviceChildGroups
     */
    DescribeDeviceChildGroups(req: DescribeDeviceChildGroupsRequest, cb?: (error: string, rep: DescribeDeviceChildGroupsResponse) => void): Promise<DescribeDeviceChildGroupsResponse>;
    /**
     * 以分页的方式查询账号分组列表，私有化调用path为：/capi/Assets/DescribeAccountGroups
     */
    DescribeAccountGroups(req: DescribeAccountGroupsRequest, cb?: (error: string, rep: DescribeAccountGroupsResponse) => void): Promise<DescribeAccountGroupsResponse>;
    /**
     * 基于软件查看终端详情列表,私有化调用path为：capi/Software/DescribeDeviceDetailList
     */
    DescribeDeviceDetailList(req: DescribeDeviceDetailListRequest, cb?: (error: string, rep: DescribeDeviceDetailListResponse) => void): Promise<DescribeDeviceDetailListResponse>;
    /**
     * 获取账号列表，支持分页，模糊搜索，私有化调用path为：/capi/Assets/Account/DescribeLocalAccounts
     */
    DescribeLocalAccounts(req: DescribeLocalAccountsRequest, cb?: (error: string, rep: DescribeLocalAccountsResponse) => void): Promise<DescribeLocalAccountsResponse>;
    /**
     * 查询边缘节点分组，私有化调用path为：capi/Connectors/DescribeDLPEdgeNodeGroups
     */
    DescribeDLPEdgeNodeGroups(req: DescribeDLPEdgeNodeGroupsRequest, cb?: (error: string, rep: DescribeDLPEdgeNodeGroupsResponse) => void): Promise<DescribeDLPEdgeNodeGroupsResponse>;
    /**
     * 查询满足条件的终端数据详情，私有化调用path为：/capi/Assets/Device/DescribeDevices
     */
    DescribeDevices(req: DescribeDevicesRequest, cb?: (error: string, rep: DescribeDevicesResponse) => void): Promise<DescribeDevicesResponse>;
    /**
     * 查询终端自定义分组列表，私有化调用path为：/capi/Assets/Device/DescribeDeviceVirtualGroups
     */
    DescribeDeviceVirtualGroups(req: DescribeDeviceVirtualGroupsRequest, cb?: (error: string, rep: DescribeDeviceVirtualGroupsResponse) => void): Promise<DescribeDeviceVirtualGroupsResponse>;
    /**
     * 查看终端树下的软件列表,私有化调用path为：capi/Software/DescribeSoftCensusListByDevice
     */
    DescribeSoftCensusListByDevice(req: DescribeSoftCensusListByDeviceRequest, cb?: (error: string, rep: DescribeSoftCensusListByDeviceResponse) => void): Promise<DescribeSoftCensusListByDeviceResponse>;
    /**
     * 终端自定义分组增减终端，私有化调用path为：/capi/Assets/Device/ModifyVirtualDeviceGroups
     */
    ModifyVirtualDeviceGroups(req: ModifyVirtualDeviceGroupsRequest, cb?: (error: string, rep: ModifyVirtualDeviceGroupsResponse) => void): Promise<ModifyVirtualDeviceGroupsResponse>;
}
