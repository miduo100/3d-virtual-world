import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("monitor.tencentcloudapi.com", "2023-06-16", clientConfig);
    }
    async DeleteNoticeContentTmpls(req, cb) {
        return this.request("DeleteNoticeContentTmpls", req, cb);
    }
    async DescribeNoticeContentTmpl(req, cb) {
        return this.request("DescribeNoticeContentTmpl", req, cb);
    }
    async DescribeAIWorkbenchSREDigitalTwinWorkLogDetail(req, cb) {
        return this.request("DescribeAIWorkbenchSREDigitalTwinWorkLogDetail", req, cb);
    }
    async CreateNoticeContentTmpl(req, cb) {
        return this.request("CreateNoticeContentTmpl", req, cb);
    }
    async TriggerAIWorkbenchSREDigitalTwinTask(req, cb) {
        return this.request("TriggerAIWorkbenchSREDigitalTwinTask", req, cb);
    }
    async ModifyNoticeContentTmpl(req, cb) {
        return this.request("ModifyNoticeContentTmpl", req, cb);
    }
    async DescribeAIWorkbenchSREDigitalTwinWorkLogList(req, cb) {
        return this.request("DescribeAIWorkbenchSREDigitalTwinWorkLogList", req, cb);
    }
    async DescribeAlarmNotifyHistories(req, cb) {
        return this.request("DescribeAlarmNotifyHistories", req, cb);
    }
    async DescribeAIWorkbenchSREDigitalTwinTaskList(req, cb) {
        return this.request("DescribeAIWorkbenchSREDigitalTwinTaskList", req, cb);
    }
}
