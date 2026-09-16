import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("ig.tencentcloudapi.com", "2021-05-18", clientConfig);
    }
    async DescribeIgOrderList(req, cb) {
        return this.request("DescribeIgOrderList", req, cb);
    }
}
