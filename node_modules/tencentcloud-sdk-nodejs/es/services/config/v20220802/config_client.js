import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("config.tencentcloudapi.com", "2022-08-02", clientConfig);
    }
    async ListAggregateConfigRules(req, cb) {
        return this.request("ListAggregateConfigRules", req, cb);
    }
    async ListDiscoveredResources(req, cb) {
        return this.request("ListDiscoveredResources", req, cb);
    }
    async ListConfigRules(req, cb) {
        return this.request("ListConfigRules", req, cb);
    }
    async DescribeAggregateDiscoveredResource(req, cb) {
        return this.request("DescribeAggregateDiscoveredResource", req, cb);
    }
    async DescribeDiscoveredResource(req, cb) {
        return this.request("DescribeDiscoveredResource", req, cb);
    }
    async ListAggregateDiscoveredResources(req, cb) {
        return this.request("ListAggregateDiscoveredResources", req, cb);
    }
    async PutEvaluations(req, cb) {
        return this.request("PutEvaluations", req, cb);
    }
}
