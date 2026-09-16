import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("es.tencentcloudapi.com", "2018-04-16", clientConfig);
    }
    async DiagnoseInstance(req, cb) {
        return this.request("DiagnoseInstance", req, cb);
    }
    async DeleteLogstashInstance(req, cb) {
        return this.request("DeleteLogstashInstance", req, cb);
    }
    async RestoreClusterSnapshot(req, cb) {
        return this.request("RestoreClusterSnapshot", req, cb);
    }
    async CreateCollector(req, cb) {
        return this.request("CreateCollector", req, cb);
    }
    async StopLogstashPipelines(req, cb) {
        return this.request("StopLogstashPipelines", req, cb);
    }
    async DescribeServerlessSpaces(req, cb) {
        return this.request("DescribeServerlessSpaces", req, cb);
    }
    async ModifyAutoBackUpStrategy(req, cb) {
        return this.request("ModifyAutoBackUpStrategy", req, cb);
    }
    async InstallInstanceModel(req, cb) {
        return this.request("InstallInstanceModel", req, cb);
    }
    async DescribeIndexList(req, cb) {
        return this.request("DescribeIndexList", req, cb);
    }
    async UpdateLogstashPipelineDesc(req, cb) {
        return this.request("UpdateLogstashPipelineDesc", req, cb);
    }
    async UpdateJdk(req, cb) {
        return this.request("UpdateJdk", req, cb);
    }
    async DescribeUserCosSnapshotList(req, cb) {
        return this.request("DescribeUserCosSnapshotList", req, cb);
    }
    async UpgradeInstance(req, cb) {
        return this.request("UpgradeInstance", req, cb);
    }
    async UpdateIndex(req, cb) {
        return this.request("UpdateIndex", req, cb);
    }
    async DeleteInstance(req, cb) {
        return this.request("DeleteInstance", req, cb);
    }
    async GetDiagnoseSettings(req, cb) {
        return this.request("GetDiagnoseSettings", req, cb);
    }
    async UpdateInstance(req, cb) {
        return this.request("UpdateInstance", req, cb);
    }
    async CreateIndex(req, cb) {
        return this.request("CreateIndex", req, cb);
    }
    async StartLogstashPipelines(req, cb) {
        return this.request("StartLogstashPipelines", req, cb);
    }
    async UpdateRequestTargetNodeTypes(req, cb) {
        return this.request("UpdateRequestTargetNodeTypes", req, cb);
    }
    async UpdateDiagnoseSettings(req, cb) {
        return this.request("UpdateDiagnoseSettings", req, cb);
    }
    async CreateCosMigrateToServerlessInstance(req, cb) {
        return this.request("CreateCosMigrateToServerlessInstance", req, cb);
    }
    async DeleteAutoBackUpStrategy(req, cb) {
        return this.request("DeleteAutoBackUpStrategy", req, cb);
    }
    async UpdatePlugins(req, cb) {
        return this.request("UpdatePlugins", req, cb);
    }
    async UpdateLogstashInstance(req, cb) {
        return this.request("UpdateLogstashInstance", req, cb);
    }
    async CheckMigrateIndexMetaData(req, cb) {
        return this.request("CheckMigrateIndexMetaData", req, cb);
    }
    async UpdateIpTraceStatus(req, cb) {
        return this.request("UpdateIpTraceStatus", req, cb);
    }
    async DeleteServerlessInstance(req, cb) {
        return this.request("DeleteServerlessInstance", req, cb);
    }
    async DescribeDiagnose(req, cb) {
        return this.request("DescribeDiagnose", req, cb);
    }
    async DescribeClusterSnapshot(req, cb) {
        return this.request("DescribeClusterSnapshot", req, cb);
    }
    async CreateLogstashInstance(req, cb) {
        return this.request("CreateLogstashInstance", req, cb);
    }
    async RestartInstance(req, cb) {
        return this.request("RestartInstance", req, cb);
    }
    async CreateAutoBackUpStrategy(req, cb) {
        return this.request("CreateAutoBackUpStrategy", req, cb);
    }
    async DescribeAutoBackUpStrategy(req, cb) {
        return this.request("DescribeAutoBackUpStrategy", req, cb);
    }
    async DescribeInstanceLogs(req, cb) {
        return this.request("DescribeInstanceLogs", req, cb);
    }
    async RestartKibana(req, cb) {
        return this.request("RestartKibana", req, cb);
    }
    async ModifyEsVipSecurityGroup(req, cb) {
        return this.request("ModifyEsVipSecurityGroup", req, cb);
    }
    async CreateServerlessInstance(req, cb) {
        return this.request("CreateServerlessInstance", req, cb);
    }
    async DescribeServerlessMetrics(req, cb) {
        return this.request("DescribeServerlessMetrics", req, cb);
    }
    async DescribeInstanceOperations(req, cb) {
        return this.request("DescribeInstanceOperations", req, cb);
    }
    async DescribeSpaceKibanaTools(req, cb) {
        return this.request("DescribeSpaceKibanaTools", req, cb);
    }
    async DescribeLogstashPipelines(req, cb) {
        return this.request("DescribeLogstashPipelines", req, cb);
    }
    async DescribeLogstashInstances(req, cb) {
        return this.request("DescribeLogstashInstances", req, cb);
    }
    async CreateServerlessSpaceV2(req, cb) {
        return this.request("CreateServerlessSpaceV2", req, cb);
    }
    async DescribeViews(req, cb) {
        return this.request("DescribeViews", req, cb);
    }
    async CreateInstance(req, cb) {
        return this.request("CreateInstance", req, cb);
    }
    async UpdateServerlessInstance(req, cb) {
        return this.request("UpdateServerlessInstance", req, cb);
    }
    async QueryIpTraceLog(req, cb) {
        return this.request("QueryIpTraceLog", req, cb);
    }
    async GetIpTraceStatus(req, cb) {
        return this.request("GetIpTraceStatus", req, cb);
    }
    async DeleteServerlessSpaceUser(req, cb) {
        return this.request("DeleteServerlessSpaceUser", req, cb);
    }
    async DeleteLogstashPipelines(req, cb) {
        return this.request("DeleteLogstashPipelines", req, cb);
    }
    async DescribeInstances(req, cb) {
        return this.request("DescribeInstances", req, cb);
    }
    async UpdateServerlessSpace(req, cb) {
        return this.request("UpdateServerlessSpace", req, cb);
    }
    async DeleteIndex(req, cb) {
        return this.request("DeleteIndex", req, cb);
    }
    async RestartLogstashInstance(req, cb) {
        return this.request("RestartLogstashInstance", req, cb);
    }
    async CreateClusterSnapshot(req, cb) {
        return this.request("CreateClusterSnapshot", req, cb);
    }
    async DeleteClusterSnapshot(req, cb) {
        return this.request("DeleteClusterSnapshot", req, cb);
    }
    async DescribeLogstashInstanceLogs(req, cb) {
        return this.request("DescribeLogstashInstanceLogs", req, cb);
    }
    async RestartNodes(req, cb) {
        return this.request("RestartNodes", req, cb);
    }
    async DescribeServerlessSpaceUser(req, cb) {
        return this.request("DescribeServerlessSpaceUser", req, cb);
    }
    async SaveAndDeployLogstashPipeline(req, cb) {
        return this.request("SaveAndDeployLogstashPipeline", req, cb);
    }
    async UpdateDictionaries(req, cb) {
        return this.request("UpdateDictionaries", req, cb);
    }
    async ExportIpTraceLog(req, cb) {
        return this.request("ExportIpTraceLog", req, cb);
    }
    async UpgradeLicense(req, cb) {
        return this.request("UpgradeLicense", req, cb);
    }
    async ModifyAutoBackUpCommonInfo(req, cb) {
        return this.request("ModifyAutoBackUpCommonInfo", req, cb);
    }
    async DescribeInstancePluginList(req, cb) {
        return this.request("DescribeInstancePluginList", req, cb);
    }
    async DescribeServerlessInstances(req, cb) {
        return this.request("DescribeServerlessInstances", req, cb);
    }
    async DescribeIndexMeta(req, cb) {
        return this.request("DescribeIndexMeta", req, cb);
    }
    async GetRequestTargetNodeTypes(req, cb) {
        return this.request("GetRequestTargetNodeTypes", req, cb);
    }
    async DescribeLogstashInstanceOperations(req, cb) {
        return this.request("DescribeLogstashInstanceOperations", req, cb);
    }
    async InquirePriceRenewInstance(req, cb) {
        return this.request("InquirePriceRenewInstance", req, cb);
    }
}
