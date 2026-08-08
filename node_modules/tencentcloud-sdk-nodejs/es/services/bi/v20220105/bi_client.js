import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("bi.tencentcloudapi.com", "2022-01-05", clientConfig);
    }
    async DescribePermissionRanksInfo(req, cb) {
        return this.request("DescribePermissionRanksInfo", req, cb);
    }
    async ModifyDatasource(req, cb) {
        return this.request("ModifyDatasource", req, cb);
    }
    async DescribeDatasourceList(req, cb) {
        return this.request("DescribeDatasourceList", req, cb);
    }
    async CreateDatasource(req, cb) {
        return this.request("CreateDatasource", req, cb);
    }
    async CreatePermissionRanks(req, cb) {
        return this.request("CreatePermissionRanks", req, cb);
    }
    async DescribeProjectInfo(req, cb) {
        return this.request("DescribeProjectInfo", req, cb);
    }
    async CreateProject(req, cb) {
        return this.request("CreateProject", req, cb);
    }
    async CreateDatasourceCloud(req, cb) {
        return this.request("CreateDatasourceCloud", req, cb);
    }
    async DescribePermissionStatusInfo(req, cb) {
        return this.request("DescribePermissionStatusInfo", req, cb);
    }
    async ModifyUserRole(req, cb) {
        return this.request("ModifyUserRole", req, cb);
    }
    async ExportScreenPage(req, cb) {
        return this.request("ExportScreenPage", req, cb);
    }
    async CreateEmbedToken(req, cb) {
        return this.request("CreateEmbedToken", req, cb);
    }
    async CreateUserRole(req, cb) {
        return this.request("CreateUserRole", req, cb);
    }
    async DeleteDatasource(req, cb) {
        return this.request("DeleteDatasource", req, cb);
    }
    async DeleteUserRole(req, cb) {
        return this.request("DeleteUserRole", req, cb);
    }
    async ModifyProject(req, cb) {
        return this.request("ModifyProject", req, cb);
    }
    async DescribeUserRoleList(req, cb) {
        return this.request("DescribeUserRoleList", req, cb);
    }
    async DescribePageWidgetList(req, cb) {
        return this.request("DescribePageWidgetList", req, cb);
    }
    async DescribeUserRoleProjectList(req, cb) {
        return this.request("DescribeUserRoleProjectList", req, cb);
    }
    async ModifyDatasourceCloud(req, cb) {
        return this.request("ModifyDatasourceCloud", req, cb);
    }
    async ClearEmbedToken(req, cb) {
        return this.request("ClearEmbedToken", req, cb);
    }
    async CreateUserRoleProject(req, cb) {
        return this.request("CreateUserRoleProject", req, cb);
    }
    async DeleteUserRoleProject(req, cb) {
        return this.request("DeleteUserRoleProject", req, cb);
    }
    async ApplyEmbedInterval(req, cb) {
        return this.request("ApplyEmbedInterval", req, cb);
    }
    async DescribePermissionRoleInfo(req, cb) {
        return this.request("DescribePermissionRoleInfo", req, cb);
    }
    async DescribeUserProjectList(req, cb) {
        return this.request("DescribeUserProjectList", req, cb);
    }
    async DeleteProject(req, cb) {
        return this.request("DeleteProject", req, cb);
    }
    async ModifyUserRoleProject(req, cb) {
        return this.request("ModifyUserRoleProject", req, cb);
    }
    async DescribeProjectList(req, cb) {
        return this.request("DescribeProjectList", req, cb);
    }
}
