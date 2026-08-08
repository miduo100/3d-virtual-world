import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("dlc.tencentcloudapi.com", "2021-01-25", clientConfig);
    }
    async CreateTask(req, cb) {
        return this.request("CreateTask", req, cb);
    }
    async AddUsersToWorkGroup(req, cb) {
        return this.request("AddUsersToWorkGroup", req, cb);
    }
    async AlterDMSTable(req, cb) {
        return this.request("AlterDMSTable", req, cb);
    }
    async DescribeForbiddenTablePro(req, cb) {
        return this.request("DescribeForbiddenTablePro", req, cb);
    }
    async DescribeUserInfo(req, cb) {
        return this.request("DescribeUserInfo", req, cb);
    }
    async ModifyUserType(req, cb) {
        return this.request("ModifyUserType", req, cb);
    }
    async LaunchStandardEngineResourceGroups(req, cb) {
        return this.request("LaunchStandardEngineResourceGroups", req, cb);
    }
    async DescribeTaskList(req, cb) {
        return this.request("DescribeTaskList", req, cb);
    }
    async DescribeWorkGroupInfo(req, cb) {
        return this.request("DescribeWorkGroupInfo", req, cb);
    }
    async DescribeTaskMonitorInfos(req, cb) {
        return this.request("DescribeTaskMonitorInfos", req, cb);
    }
    async DescribeNotebookSession(req, cb) {
        return this.request("DescribeNotebookSession", req, cb);
    }
    async CreateNotebookSession(req, cb) {
        return this.request("CreateNotebookSession", req, cb);
    }
    async DescribeDataMaskStrategies(req, cb) {
        return this.request("DescribeDataMaskStrategies", req, cb);
    }
    async DeleteWorkGroup(req, cb) {
        return this.request("DeleteWorkGroup", req, cb);
    }
    async UnlockMetaData(req, cb) {
        return this.request("UnlockMetaData", req, cb);
    }
    async DescribeDataEngine(req, cb) {
        return this.request("DescribeDataEngine", req, cb);
    }
    async CreateStoreLocation(req, cb) {
        return this.request("CreateStoreLocation", req, cb);
    }
    async CreateNotebookSessionStatementSupportBatchSQL(req, cb) {
        return this.request("CreateNotebookSessionStatementSupportBatchSQL", req, cb);
    }
    async SwitchDataEngine(req, cb) {
        return this.request("SwitchDataEngine", req, cb);
    }
    async AlterDMSDatabase(req, cb) {
        return this.request("AlterDMSDatabase", req, cb);
    }
    async CreateDatasourceConnection(req, cb) {
        return this.request("CreateDatasourceConnection", req, cb);
    }
    async DescribeUserRegisterTime(req, cb) {
        return this.request("DescribeUserRegisterTime", req, cb);
    }
    async DescribeNotebookSessions(req, cb) {
        return this.request("DescribeNotebookSessions", req, cb);
    }
    async DescribeDMSPartitions(req, cb) {
        return this.request("DescribeDMSPartitions", req, cb);
    }
    async CancelTask(req, cb) {
        return this.request("CancelTask", req, cb);
    }
    async DeleteDataMaskStrategy(req, cb) {
        return this.request("DeleteDataMaskStrategy", req, cb);
    }
    async DescribeDLCCatalogAccess(req, cb) {
        return this.request("DescribeDLCCatalogAccess", req, cb);
    }
    async DescribeDMSTables(req, cb) {
        return this.request("DescribeDMSTables", req, cb);
    }
    async DescribeNativeSparkSessions(req, cb) {
        return this.request("DescribeNativeSparkSessions", req, cb);
    }
    async DescribeUserType(req, cb) {
        return this.request("DescribeUserType", req, cb);
    }
    async UpdateStandardEngineResourceGroupResourceInfo(req, cb) {
        return this.request("UpdateStandardEngineResourceGroupResourceInfo", req, cb);
    }
    async RenewDataEngine(req, cb) {
        return this.request("RenewDataEngine", req, cb);
    }
    async DescribeUserRoles(req, cb) {
        return this.request("DescribeUserRoles", req, cb);
    }
    async DescribeNetworkConnections(req, cb) {
        return this.request("DescribeNetworkConnections", req, cb);
    }
    async CreateStandardEngineResourceGroup(req, cb) {
        return this.request("CreateStandardEngineResourceGroup", req, cb);
    }
    async DescribeTasks(req, cb) {
        return this.request("DescribeTasks", req, cb);
    }
    async DeleteScript(req, cb) {
        return this.request("DeleteScript", req, cb);
    }
    async DeleteTable(req, cb) {
        return this.request("DeleteTable", req, cb);
    }
    async CreateSparkAppTask(req, cb) {
        return this.request("CreateSparkAppTask", req, cb);
    }
    async DescribeOtherCHDFSBindingList(req, cb) {
        return this.request("DescribeOtherCHDFSBindingList", req, cb);
    }
    async UpdateStandardEngineResourceGroupBaseInfo(req, cb) {
        return this.request("UpdateStandardEngineResourceGroupBaseInfo", req, cb);
    }
    async DescribeLakeFsDirSummary(req, cb) {
        return this.request("DescribeLakeFsDirSummary", req, cb);
    }
    async DescribeDatabases(req, cb) {
        return this.request("DescribeDatabases", req, cb);
    }
    async AlterDMSPartition(req, cb) {
        return this.request("AlterDMSPartition", req, cb);
    }
    async DescribeThirdPartyAccessUser(req, cb) {
        return this.request("DescribeThirdPartyAccessUser", req, cb);
    }
    async RevokeDLCCatalogAccess(req, cb) {
        return this.request("RevokeDLCCatalogAccess", req, cb);
    }
    async CreateUser(req, cb) {
        return this.request("CreateUser", req, cb);
    }
    async DescribeTables(req, cb) {
        return this.request("DescribeTables", req, cb);
    }
    async ListTaskJobLogName(req, cb) {
        return this.request("ListTaskJobLogName", req, cb);
    }
    async SwitchDataEngineImage(req, cb) {
        return this.request("SwitchDataEngineImage", req, cb);
    }
    async AssociateDatasourceHouse(req, cb) {
        return this.request("AssociateDatasourceHouse", req, cb);
    }
    async DescribeLakeFsTaskResult(req, cb) {
        return this.request("DescribeLakeFsTaskResult", req, cb);
    }
    async AddOptimizerEngines(req, cb) {
        return this.request("AddOptimizerEngines", req, cb);
    }
    async UpdateRowFilter(req, cb) {
        return this.request("UpdateRowFilter", req, cb);
    }
    async DescribeAdvancedStoreLocation(req, cb) {
        return this.request("DescribeAdvancedStoreLocation", req, cb);
    }
    async LockMetaData(req, cb) {
        return this.request("LockMetaData", req, cb);
    }
    async DescribeSparkAppJobs(req, cb) {
        return this.request("DescribeSparkAppJobs", req, cb);
    }
    async DescribeUsers(req, cb) {
        return this.request("DescribeUsers", req, cb);
    }
    async CreateTasks(req, cb) {
        return this.request("CreateTasks", req, cb);
    }
    async DescribeScripts(req, cb) {
        return this.request("DescribeScripts", req, cb);
    }
    async AttachDataMaskPolicy(req, cb) {
        return this.request("AttachDataMaskPolicy", req, cb);
    }
    async ModifyWorkGroup(req, cb) {
        return this.request("ModifyWorkGroup", req, cb);
    }
    async DescribeTablesName(req, cb) {
        return this.request("DescribeTablesName", req, cb);
    }
    async DeleteCHDFSBindingProduct(req, cb) {
        return this.request("DeleteCHDFSBindingProduct", req, cb);
    }
    async PauseStandardEngineResourceGroups(req, cb) {
        return this.request("PauseStandardEngineResourceGroups", req, cb);
    }
    async ReportHeartbeatMetaData(req, cb) {
        return this.request("ReportHeartbeatMetaData", req, cb);
    }
    async DescribeSparkSessionBatchSQLCost(req, cb) {
        return this.request("DescribeSparkSessionBatchSQLCost", req, cb);
    }
    async DescribeUpdatableDataEngines(req, cb) {
        return this.request("DescribeUpdatableDataEngines", req, cb);
    }
    async CreateInternalTable(req, cb) {
        return this.request("CreateInternalTable", req, cb);
    }
    async GenerateCreateMangedTableSql(req, cb) {
        return this.request("GenerateCreateMangedTableSql", req, cb);
    }
    async AttachWorkGroupPolicy(req, cb) {
        return this.request("AttachWorkGroupPolicy", req, cb);
    }
    async DescribeDataEnginesScaleDetail(req, cb) {
        return this.request("DescribeDataEnginesScaleDetail", req, cb);
    }
    async CreateSparkApp(req, cb) {
        return this.request("CreateSparkApp", req, cb);
    }
    async DeleteStandardEngineResourceGroup(req, cb) {
        return this.request("DeleteStandardEngineResourceGroup", req, cb);
    }
    async CreateDatabase(req, cb) {
        return this.request("CreateDatabase", req, cb);
    }
    async RollbackDataEngineImage(req, cb) {
        return this.request("RollbackDataEngineImage", req, cb);
    }
    async DescribeSessionImageVersion(req, cb) {
        return this.request("DescribeSessionImageVersion", req, cb);
    }
    async DescribeSubUserAccessPolicy(req, cb) {
        return this.request("DescribeSubUserAccessPolicy", req, cb);
    }
    async CreateSparkSessionBatchSQL(req, cb) {
        return this.request("CreateSparkSessionBatchSQL", req, cb);
    }
    async CreateUserVpcConnection(req, cb) {
        return this.request("CreateUserVpcConnection", req, cb);
    }
    async DescribeUDFPolicy(req, cb) {
        return this.request("DescribeUDFPolicy", req, cb);
    }
    async DescribeNotebookSessionStatements(req, cb) {
        return this.request("DescribeNotebookSessionStatements", req, cb);
    }
    async GrantDLCCatalogAccess(req, cb) {
        return this.request("GrantDLCCatalogAccess", req, cb);
    }
    async SuspendResumeDataEngine(req, cb) {
        return this.request("SuspendResumeDataEngine", req, cb);
    }
    async CreateDMSDatabase(req, cb) {
        return this.request("CreateDMSDatabase", req, cb);
    }
    async AttachUserPolicy(req, cb) {
        return this.request("AttachUserPolicy", req, cb);
    }
    async ModifyGovernEventRule(req, cb) {
        return this.request("ModifyGovernEventRule", req, cb);
    }
    async CreateResultDownload(req, cb) {
        return this.request("CreateResultDownload", req, cb);
    }
    async ModifyAdvancedStoreLocation(req, cb) {
        return this.request("ModifyAdvancedStoreLocation", req, cb);
    }
    async DescribeNotebookSessionStatementSqlResult(req, cb) {
        return this.request("DescribeNotebookSessionStatementSqlResult", req, cb);
    }
    async CreateNotebookSessionStatement(req, cb) {
        return this.request("CreateNotebookSessionStatement", req, cb);
    }
    async UnboundDatasourceHouse(req, cb) {
        return this.request("UnboundDatasourceHouse", req, cb);
    }
    async DescribeStandardEngineResourceGroupConfigInfo(req, cb) {
        return this.request("DescribeStandardEngineResourceGroupConfigInfo", req, cb);
    }
    async DescribeDataEngines(req, cb) {
        return this.request("DescribeDataEngines", req, cb);
    }
    async DescribeSparkSessionBatchSQL(req, cb) {
        return this.request("DescribeSparkSessionBatchSQL", req, cb);
    }
    async DropDMSDatabase(req, cb) {
        return this.request("DropDMSDatabase", req, cb);
    }
    async AddDMSPartitions(req, cb) {
        return this.request("AddDMSPartitions", req, cb);
    }
    async UpdateUserDataEngineConfig(req, cb) {
        return this.request("UpdateUserDataEngineConfig", req, cb);
    }
    async CancelNotebookSessionStatementBatch(req, cb) {
        return this.request("CancelNotebookSessionStatementBatch", req, cb);
    }
    async CheckDataEngineImageCanBeUpgrade(req, cb) {
        return this.request("CheckDataEngineImageCanBeUpgrade", req, cb);
    }
    async DeleteSparkApp(req, cb) {
        return this.request("DeleteSparkApp", req, cb);
    }
    async DescribeTaskResourceUsage(req, cb) {
        return this.request("DescribeTaskResourceUsage", req, cb);
    }
    async DescribeNotebookSessionLog(req, cb) {
        return this.request("DescribeNotebookSessionLog", req, cb);
    }
    async DescribeTasksCostInfo(req, cb) {
        return this.request("DescribeTasksCostInfo", req, cb);
    }
    async DescribeResultDownload(req, cb) {
        return this.request("DescribeResultDownload", req, cb);
    }
    async DescribeDMSTable(req, cb) {
        return this.request("DescribeDMSTable", req, cb);
    }
    async QueryTaskCostDetail(req, cb) {
        return this.request("QueryTaskCostDetail", req, cb);
    }
    async DropDMSPartitions(req, cb) {
        return this.request("DropDMSPartitions", req, cb);
    }
    async CreateWorkGroup(req, cb) {
        return this.request("CreateWorkGroup", req, cb);
    }
    async CreateTcIcebergTable(req, cb) {
        return this.request("CreateTcIcebergTable", req, cb);
    }
    async CreateCHDFSBindingProduct(req, cb) {
        return this.request("CreateCHDFSBindingProduct", req, cb);
    }
    async QueryInternalTableWarehouse(req, cb) {
        return this.request("QueryInternalTableWarehouse", req, cb);
    }
    async DescribeDatasourceConnection(req, cb) {
        return this.request("DescribeDatasourceConnection", req, cb);
    }
    async DescribeTablePartitions(req, cb) {
        return this.request("DescribeTablePartitions", req, cb);
    }
    async CheckDataEngineImageCanBeRollback(req, cb) {
        return this.request("CheckDataEngineImageCanBeRollback", req, cb);
    }
    async CancelSparkSessionBatchSQL(req, cb) {
        return this.request("CancelSparkSessionBatchSQL", req, cb);
    }
    async ModifyUser(req, cb) {
        return this.request("ModifyUser", req, cb);
    }
    async DescribeSparkSessionBatchSqlLog(req, cb) {
        return this.request("DescribeSparkSessionBatchSqlLog", req, cb);
    }
    async DescribeTable(req, cb) {
        return this.request("DescribeTable", req, cb);
    }
    async GetOptimizerPolicy(req, cb) {
        return this.request("GetOptimizerPolicy", req, cb);
    }
    async DescribeResourceGroupUsageInfo(req, cb) {
        return this.request("DescribeResourceGroupUsageInfo", req, cb);
    }
    async DeleteUserVpcConnection(req, cb) {
        return this.request("DeleteUserVpcConnection", req, cb);
    }
    async DeleteNativeSparkSession(req, cb) {
        return this.request("DeleteNativeSparkSession", req, cb);
    }
    async CheckDataEngineConfigPairsValidity(req, cb) {
        return this.request("CheckDataEngineConfigPairsValidity", req, cb);
    }
    async DescribeUserVpcConnection(req, cb) {
        return this.request("DescribeUserVpcConnection", req, cb);
    }
    async DeleteDataEngine(req, cb) {
        return this.request("DeleteDataEngine", req, cb);
    }
    async DeleteUser(req, cb) {
        return this.request("DeleteUser", req, cb);
    }
    async DescribeDataEngineSessionParameters(req, cb) {
        return this.request("DescribeDataEngineSessionParameters", req, cb);
    }
    async DescribeEngineUsageInfo(req, cb) {
        return this.request("DescribeEngineUsageInfo", req, cb);
    }
    async DescribeTasksOverview(req, cb) {
        return this.request("DescribeTasksOverview", req, cb);
    }
    async UpdateDataMaskStrategy(req, cb) {
        return this.request("UpdateDataMaskStrategy", req, cb);
    }
    async UpdateDataEngineConfig(req, cb) {
        return this.request("UpdateDataEngineConfig", req, cb);
    }
    async CreateTasksInOrder(req, cb) {
        return this.request("CreateTasksInOrder", req, cb);
    }
    async DescribeDataEngineImageVersions(req, cb) {
        return this.request("DescribeDataEngineImageVersions", req, cb);
    }
    async CreateDMSTable(req, cb) {
        return this.request("CreateDMSTable", req, cb);
    }
    async AssignMangedTableProperties(req, cb) {
        return this.request("AssignMangedTableProperties", req, cb);
    }
    async UpgradeDataEngineImage(req, cb) {
        return this.request("UpgradeDataEngineImage", req, cb);
    }
    async DetachUserPolicy(req, cb) {
        return this.request("DetachUserPolicy", req, cb);
    }
    async UpdateUDFPolicy(req, cb) {
        return this.request("UpdateUDFPolicy", req, cb);
    }
    async DescribeDataEngineEvents(req, cb) {
        return this.request("DescribeDataEngineEvents", req, cb);
    }
    async DetachWorkGroupPolicy(req, cb) {
        return this.request("DetachWorkGroupPolicy", req, cb);
    }
    async DropDMSTable(req, cb) {
        return this.request("DropDMSTable", req, cb);
    }
    async QueryResult(req, cb) {
        return this.request("QueryResult", req, cb);
    }
    async CheckLockMetaData(req, cb) {
        return this.request("CheckLockMetaData", req, cb);
    }
    async CreateImportTask(req, cb) {
        return this.request("CreateImportTask", req, cb);
    }
    async UpdateStandardEngineResourceGroupConfigInfo(req, cb) {
        return this.request("UpdateStandardEngineResourceGroupConfigInfo", req, cb);
    }
    async CancelTasks(req, cb) {
        return this.request("CancelTasks", req, cb);
    }
    async CreateTable(req, cb) {
        return this.request("CreateTable", req, cb);
    }
    async DescribeTaskResult(req, cb) {
        return this.request("DescribeTaskResult", req, cb);
    }
    async CreateExportTask(req, cb) {
        return this.request("CreateExportTask", req, cb);
    }
    async RegisterThirdPartyAccessUser(req, cb) {
        return this.request("RegisterThirdPartyAccessUser", req, cb);
    }
    async DescribeTasksAnalysis(req, cb) {
        return this.request("DescribeTasksAnalysis", req, cb);
    }
    async DeleteUsersFromWorkGroup(req, cb) {
        return this.request("DeleteUsersFromWorkGroup", req, cb);
    }
    async UpdateNetworkConnection(req, cb) {
        return this.request("UpdateNetworkConnection", req, cb);
    }
    async DescribeSparkAppTasks(req, cb) {
        return this.request("DescribeSparkAppTasks", req, cb);
    }
    async UnbindWorkGroupsFromUser(req, cb) {
        return this.request("UnbindWorkGroupsFromUser", req, cb);
    }
    async CreateSparkSubmitTask(req, cb) {
        return this.request("CreateSparkSubmitTask", req, cb);
    }
    async DescribeWorkGroups(req, cb) {
        return this.request("DescribeWorkGroups", req, cb);
    }
    async CreateScript(req, cb) {
        return this.request("CreateScript", req, cb);
    }
    async RestartDataEngine(req, cb) {
        return this.request("RestartDataEngine", req, cb);
    }
    async DescribeNotebookSessionStatement(req, cb) {
        return this.request("DescribeNotebookSessionStatement", req, cb);
    }
    async DescribeClusterMonitorInfos(req, cb) {
        return this.request("DescribeClusterMonitorInfos", req, cb);
    }
    async DescribeEngineNodeSpec(req, cb) {
        return this.request("DescribeEngineNodeSpec", req, cb);
    }
    async ModifySparkApp(req, cb) {
        return this.request("ModifySparkApp", req, cb);
    }
    async DescribeViews(req, cb) {
        return this.request("DescribeViews", req, cb);
    }
    async DeleteThirdPartyAccessUser(req, cb) {
        return this.request("DeleteThirdPartyAccessUser", req, cb);
    }
    async UpdateEngineResourceGroupNetworkConfigInfo(req, cb) {
        return this.request("UpdateEngineResourceGroupNetworkConfigInfo", req, cb);
    }
    async ModifySparkAppBatch(req, cb) {
        return this.request("ModifySparkAppBatch", req, cb);
    }
    async DescribeDMSDatabase(req, cb) {
        return this.request("DescribeDMSDatabase", req, cb);
    }
    async BindWorkGroupsToUser(req, cb) {
        return this.request("BindWorkGroupsToUser", req, cb);
    }
    async DescribeUserDataEngineConfig(req, cb) {
        return this.request("DescribeUserDataEngineConfig", req, cb);
    }
    async DescribeTaskLog(req, cb) {
        return this.request("DescribeTaskLog", req, cb);
    }
    async ModifyDataEngineDescription(req, cb) {
        return this.request("ModifyDataEngineDescription", req, cb);
    }
    async DeleteNotebookSession(req, cb) {
        return this.request("DeleteNotebookSession", req, cb);
    }
    async CancelNotebookSessionStatement(req, cb) {
        return this.request("CancelNotebookSessionStatement", req, cb);
    }
    async CreateDataMaskStrategy(req, cb) {
        return this.request("CreateDataMaskStrategy", req, cb);
    }
    async DescribeStoreLocation(req, cb) {
        return this.request("DescribeStoreLocation", req, cb);
    }
    async DescribeSparkAppJob(req, cb) {
        return this.request("DescribeSparkAppJob", req, cb);
    }
    async SetOptimizerPolicy(req, cb) {
        return this.request("SetOptimizerPolicy", req, cb);
    }
    async CreateDataEngine(req, cb) {
        return this.request("CreateDataEngine", req, cb);
    }
    async DescribeDataEnginePythonSparkImages(req, cb) {
        return this.request("DescribeDataEnginePythonSparkImages", req, cb);
    }
    async DescribeStandardEngineResourceGroups(req, cb) {
        return this.request("DescribeStandardEngineResourceGroups", req, cb);
    }
    async ListTaskJobLogDetail(req, cb) {
        return this.request("ListTaskJobLogDetail", req, cb);
    }
    async DescribeEngineNetworks(req, cb) {
        return this.request("DescribeEngineNetworks", req, cb);
    }
    async DescribeLakeFsInfo(req, cb) {
        return this.request("DescribeLakeFsInfo", req, cb);
    }
    async UpdateDataEngine(req, cb) {
        return this.request("UpdateDataEngine", req, cb);
    }
}
