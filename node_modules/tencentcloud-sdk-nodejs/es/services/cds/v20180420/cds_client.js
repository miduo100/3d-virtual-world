import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("cds.tencentcloudapi.com", "2018-04-20", clientConfig);
    }
    async DescribeDbauditInstanceType(req, cb) {
        return this.request("DescribeDbauditInstanceType", req, cb);
    }
    async ModifyDbauditInstancesRenewFlag(req, cb) {
        return this.request("ModifyDbauditInstancesRenewFlag", req, cb);
    }
    async DescribeDbauditInstances(req, cb) {
        return this.request("DescribeDbauditInstances", req, cb);
    }
    async InquiryPriceDbauditInstance(req, cb) {
        return this.request("InquiryPriceDbauditInstance", req, cb);
    }
    async DescribeDbauditUsedRegions(req, cb) {
        return this.request("DescribeDbauditUsedRegions", req, cb);
    }
}
