import { AbstractClient } from "../../../common/abstract_client";
import { ClientConfig } from "../../../common/interface";
import { DeleteProjectRequest, ExportScreenPageResponse, DeleteUserRoleResponse, DescribeUserProjectListRequest, DescribeProjectListResponse, ModifyDatasourceCloudResponse, CreateUserRoleResponse, CreateUserRoleProjectRequest, DescribePermissionStatusInfoRequest, CreateDatasourceResponse, DeleteDatasourceResponse, CreateProjectRequest, DescribePermissionStatusInfoResponse, ApplyEmbedIntervalRequest, DescribePermissionRoleInfoResponse, CreatePermissionRanksRequest, DescribeProjectInfoRequest, ModifyUserRoleRequest, CreateUserRoleRequest, CreateEmbedTokenRequest, ModifyDatasourceRequest, CreatePermissionRanksResponse, CreateProjectResponse, DescribeProjectInfoResponse, DeleteProjectResponse, ApplyEmbedIntervalResponse, DescribeUserRoleListResponse, DescribePageWidgetListRequest, DescribeUserRoleProjectListRequest, DescribeUserRoleProjectListResponse, DeleteUserRoleRequest, CreateUserRoleProjectResponse, DeleteUserRoleProjectRequest, DescribeUserRoleListRequest, ClearEmbedTokenResponse, DeleteUserRoleProjectResponse, DescribePermissionRoleInfoRequest, CreateDatasourceCloudRequest, ModifyDatasourceCloudRequest, ClearEmbedTokenRequest, DescribeUserProjectListResponse, CreateDatasourceRequest, DeleteDatasourceRequest, ModifyDatasourceResponse, DescribePageWidgetListResponse, CreateDatasourceCloudResponse, ModifyProjectResponse, ModifyUserRoleResponse, DescribePermissionRanksInfoResponse, ModifyUserRoleProjectResponse, ModifyProjectRequest, ModifyUserRoleProjectRequest, DescribeProjectListRequest, CreateEmbedTokenResponse, DescribeDatasourceListRequest, DescribePermissionRanksInfoRequest, DescribeDatasourceListResponse, ExportScreenPageRequest } from "./bi_models";
/**
 * bi client
 * @class
 */
export declare class Client extends AbstractClient {
    constructor(clientConfig: ClientConfig);
    /**
     * 根据角色或标签查询行列权限配置
     */
    DescribePermissionRanksInfo(req: DescribePermissionRanksInfoRequest, cb?: (error: string, rep: DescribePermissionRanksInfoResponse) => void): Promise<DescribePermissionRanksInfoResponse>;
    /**
     * 更新数据源
     */
    ModifyDatasource(req: ModifyDatasourceRequest, cb?: (error: string, rep: ModifyDatasourceResponse) => void): Promise<ModifyDatasourceResponse>;
    /**
     * 查询数据源列表
     */
    DescribeDatasourceList(req: DescribeDatasourceListRequest, cb?: (error: string, rep: DescribeDatasourceListResponse) => void): Promise<DescribeDatasourceListResponse>;
    /**
     * 创建数据源
     */
    CreateDatasource(req: CreateDatasourceRequest, cb?: (error: string, rep: CreateDatasourceResponse) => void): Promise<CreateDatasourceResponse>;
    /**
     * 创建行列权限
     */
    CreatePermissionRanks(req: CreatePermissionRanksRequest, cb?: (error: string, rep: CreatePermissionRanksResponse) => void): Promise<CreatePermissionRanksResponse>;
    /**
     * 项目详情接口
     */
    DescribeProjectInfo(req: DescribeProjectInfoRequest, cb?: (error: string, rep: DescribeProjectInfoResponse) => void): Promise<DescribeProjectInfoResponse>;
    /**
     * 创建项目
     */
    CreateProject(req: CreateProjectRequest, cb?: (error: string, rep: CreateProjectResponse) => void): Promise<CreateProjectResponse>;
    /**
     * 创建云数据库
     */
    CreateDatasourceCloud(req: CreateDatasourceCloudRequest, cb?: (error: string, rep: CreateDatasourceCloudResponse) => void): Promise<CreateDatasourceCloudResponse>;
    /**
     * 查询行列权限初始状态1
     */
    DescribePermissionStatusInfo(req: DescribePermissionStatusInfoRequest, cb?: (error: string, rep: DescribePermissionStatusInfoResponse) => void): Promise<DescribePermissionStatusInfoResponse>;
    /**
     * 修改用户角色信息
     */
    ModifyUserRole(req: ModifyUserRoleRequest, cb?: (error: string, rep: ModifyUserRoleResponse) => void): Promise<ModifyUserRoleResponse>;
    /**
     * 页面截图导出
     */
    ExportScreenPage(req: ExportScreenPageRequest, cb?: (error: string, rep: ExportScreenPageResponse) => void): Promise<ExportScreenPageResponse>;
    /**
     * 创建嵌出报表-强鉴权
     */
    CreateEmbedToken(req: CreateEmbedTokenRequest, cb?: (error: string, rep: CreateEmbedTokenResponse) => void): Promise<CreateEmbedTokenResponse>;
    /**
     * 创建用户角色
     */
    CreateUserRole(req: CreateUserRoleRequest, cb?: (error: string, rep: CreateUserRoleResponse) => void): Promise<CreateUserRoleResponse>;
    /**
     * 删除数据源
     */
    DeleteDatasource(req: DeleteDatasourceRequest, cb?: (error: string, rep: DeleteDatasourceResponse) => void): Promise<DeleteDatasourceResponse>;
    /**
     * 删除用户角色，会删除用户
     */
    DeleteUserRole(req: DeleteUserRoleRequest, cb?: (error: string, rep: DeleteUserRoleResponse) => void): Promise<DeleteUserRoleResponse>;
    /**
     * 修改项目信息
     */
    ModifyProject(req: ModifyProjectRequest, cb?: (error: string, rep: ModifyProjectResponse) => void): Promise<ModifyProjectResponse>;
    /**
     * 用户角色列表
     */
    DescribeUserRoleList(req: DescribeUserRoleListRequest, cb?: (error: string, rep: DescribeUserRoleListResponse) => void): Promise<DescribeUserRoleListResponse>;
    /**
     * 查询页面组件信息
     */
    DescribePageWidgetList(req: DescribePageWidgetListRequest, cb?: (error: string, rep: DescribePageWidgetListResponse) => void): Promise<DescribePageWidgetListResponse>;
    /**
     * 项目内-用户角色列表
     */
    DescribeUserRoleProjectList(req: DescribeUserRoleProjectListRequest, cb?: (error: string, rep: DescribeUserRoleProjectListResponse) => void): Promise<DescribeUserRoleProjectListResponse>;
    /**
     * 更新云数据库
     */
    ModifyDatasourceCloud(req: ModifyDatasourceCloudRequest, cb?: (error: string, rep: ModifyDatasourceCloudResponse) => void): Promise<ModifyDatasourceCloudResponse>;
    /**
     * 强鉴权token 清理，只有企业管理员才能调用该接口
     */
    ClearEmbedToken(req: ClearEmbedTokenRequest, cb?: (error: string, rep: ClearEmbedTokenResponse) => void): Promise<ClearEmbedTokenResponse>;
    /**
     * 项目内-创建用户角色
     */
    CreateUserRoleProject(req: CreateUserRoleProjectRequest, cb?: (error: string, rep: CreateUserRoleProjectResponse) => void): Promise<CreateUserRoleProjectResponse>;
    /**
     * 项目内-删除用户角色
     */
    DeleteUserRoleProject(req: DeleteUserRoleProjectRequest, cb?: (error: string, rep: DeleteUserRoleProjectResponse) => void): Promise<DeleteUserRoleProjectResponse>;
    /**
     * 申请延长Token可用时间接口-强鉴权
     */
    ApplyEmbedInterval(req: ApplyEmbedIntervalRequest, cb?: (error: string, rep: ApplyEmbedIntervalResponse) => void): Promise<ApplyEmbedIntervalResponse>;
    /**
     * 行列权限项目内角色列表接口1
     */
    DescribePermissionRoleInfo(req: DescribePermissionRoleInfoRequest, cb?: (error: string, rep: DescribePermissionRoleInfoResponse) => void): Promise<DescribePermissionRoleInfoResponse>;
    /**
     * 项目内-用户接口
     */
    DescribeUserProjectList(req: DescribeUserProjectListRequest, cb?: (error: string, rep: DescribeUserProjectListResponse) => void): Promise<DescribeUserProjectListResponse>;
    /**
     * 删除项目
     */
    DeleteProject(req: DeleteProjectRequest, cb?: (error: string, rep: DeleteProjectResponse) => void): Promise<DeleteProjectResponse>;
    /**
     * 项目-修改用户角色信息
     */
    ModifyUserRoleProject(req: ModifyUserRoleProjectRequest, cb?: (error: string, rep: ModifyUserRoleProjectResponse) => void): Promise<ModifyUserRoleProjectResponse>;
    /**
     * 项目信息
     */
    DescribeProjectList(req: DescribeProjectListRequest, cb?: (error: string, rep: DescribeProjectListResponse) => void): Promise<DescribeProjectListResponse>;
}
