import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("dbdc.tencentcloudapi.com", "2020-10-29", clientConfig);
    }
    async DescribeInstanceList(req, cb) {
        return this.request("DescribeInstanceList", req, cb);
    }
    async DescribeInstances(req, cb) {
        return this.request("DescribeInstances", req, cb);
    }
    async DescribeHostList(req, cb) {
        return this.request("DescribeHostList", req, cb);
    }
    async ModifyInstanceName(req, cb) {
        return this.request("ModifyInstanceName", req, cb);
    }
    async DescribeInstanceDetail(req, cb) {
        return this.request("DescribeInstanceDetail", req, cb);
    }
    async DescribeDBInstances(req, cb) {
        return this.request("DescribeDBInstances", req, cb);
    }
}
