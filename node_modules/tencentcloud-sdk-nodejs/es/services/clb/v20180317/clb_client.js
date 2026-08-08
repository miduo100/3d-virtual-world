import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("clb.tencentcloudapi.com", "2018-03-17", clientConfig);
    }
    async DescribeCustomizedConfigAssociateList(req, cb) {
        return this.request("DescribeCustomizedConfigAssociateList", req, cb);
    }
    async InquiryPriceModifyLoadBalancer(req, cb) {
        return this.request("InquiryPriceModifyLoadBalancer", req, cb);
    }
    async BatchDeregisterTargets(req, cb) {
        return this.request("BatchDeregisterTargets", req, cb);
    }
    async DescribeExclusiveClusters(req, cb) {
        return this.request("DescribeExclusiveClusters", req, cb);
    }
    async AutoRewrite(req, cb) {
        return this.request("AutoRewrite", req, cb);
    }
    async ModifyTargetGroupInstancesWeight(req, cb) {
        return this.request("ModifyTargetGroupInstancesWeight", req, cb);
    }
    async AssociateCustomizedConfig(req, cb) {
        return this.request("AssociateCustomizedConfig", req, cb);
    }
    async DeregisterTargetsFromClassicalLB(req, cb) {
        return this.request("DeregisterTargetsFromClassicalLB", req, cb);
    }
    async DescribeLoadBalancersDetail(req, cb) {
        return this.request("DescribeLoadBalancersDetail", req, cb);
    }
    async AssociateTargetGroups(req, cb) {
        return this.request("AssociateTargetGroups", req, cb);
    }
    async DeregisterTargetGroupInstances(req, cb) {
        return this.request("DeregisterTargetGroupInstances", req, cb);
    }
    async DescribeListeners(req, cb) {
        return this.request("DescribeListeners", req, cb);
    }
    async CreateTopic(req, cb) {
        return this.request("CreateTopic", req, cb);
    }
    async ModifyLoadBalancersProject(req, cb) {
        return this.request("ModifyLoadBalancersProject", req, cb);
    }
    async SetCustomizedConfigForLoadBalancer(req, cb) {
        return this.request("SetCustomizedConfigForLoadBalancer", req, cb);
    }
    async DescribeTargetGroupInstanceStatus(req, cb) {
        return this.request("DescribeTargetGroupInstanceStatus", req, cb);
    }
    async RegisterTargetsWithClassicalLB(req, cb) {
        return this.request("RegisterTargetsWithClassicalLB", req, cb);
    }
    async DeregisterTargets(req, cb) {
        return this.request("DeregisterTargets", req, cb);
    }
    async ModifyLoadBalancerAttributes(req, cb) {
        return this.request("ModifyLoadBalancerAttributes", req, cb);
    }
    async ModifyTargetGroupInstancesPort(req, cb) {
        return this.request("ModifyTargetGroupInstancesPort", req, cb);
    }
    async BatchModifyTargetWeight(req, cb) {
        return this.request("BatchModifyTargetWeight", req, cb);
    }
    async DeleteRewrite(req, cb) {
        return this.request("DeleteRewrite", req, cb);
    }
    async DisassociateCustomizedConfig(req, cb) {
        return this.request("DisassociateCustomizedConfig", req, cb);
    }
    async SetLoadBalancerSecurityGroups(req, cb) {
        return this.request("SetLoadBalancerSecurityGroups", req, cb);
    }
    async InquiryPriceRefundLoadBalancer(req, cb) {
        return this.request("InquiryPriceRefundLoadBalancer", req, cb);
    }
    async DeleteListener(req, cb) {
        return this.request("DeleteListener", req, cb);
    }
    async SetSecurityGroupForLoadbalancers(req, cb) {
        return this.request("SetSecurityGroupForLoadbalancers", req, cb);
    }
    async RegisterTargetGroupInstances(req, cb) {
        return this.request("RegisterTargetGroupInstances", req, cb);
    }
    async SetLoadBalancerStartStatus(req, cb) {
        return this.request("SetLoadBalancerStartStatus", req, cb);
    }
    async ModifyListener(req, cb) {
        return this.request("ModifyListener", req, cb);
    }
    async DescribeResources(req, cb) {
        return this.request("DescribeResources", req, cb);
    }
    async DescribeLBListeners(req, cb) {
        return this.request("DescribeLBListeners", req, cb);
    }
    async BatchRegisterTargets(req, cb) {
        return this.request("BatchRegisterTargets", req, cb);
    }
    async RegisterFunctionTargets(req, cb) {
        return this.request("RegisterFunctionTargets", req, cb);
    }
    async DescribeCustomizedConfigList(req, cb) {
        return this.request("DescribeCustomizedConfigList", req, cb);
    }
    async ModifyRule(req, cb) {
        return this.request("ModifyRule", req, cb);
    }
    async SetLoadBalancerClsLog(req, cb) {
        return this.request("SetLoadBalancerClsLog", req, cb);
    }
    async ModifyBlockIPList(req, cb) {
        return this.request("ModifyBlockIPList", req, cb);
    }
    async RenewLoadBalancers(req, cb) {
        return this.request("RenewLoadBalancers", req, cb);
    }
    async ModifyTargetPort(req, cb) {
        return this.request("ModifyTargetPort", req, cb);
    }
    async DeregisterFunctionTargets(req, cb) {
        return this.request("DeregisterFunctionTargets", req, cb);
    }
    async ModifyLoadBalancerSla(req, cb) {
        return this.request("ModifyLoadBalancerSla", req, cb);
    }
    async DescribeClusterResources(req, cb) {
        return this.request("DescribeClusterResources", req, cb);
    }
    async DescribeBlockIPTask(req, cb) {
        return this.request("DescribeBlockIPTask", req, cb);
    }
    async DescribeClassicalLBByInstanceId(req, cb) {
        return this.request("DescribeClassicalLBByInstanceId", req, cb);
    }
    async DescribeLoadBalancerTraffic(req, cb) {
        return this.request("DescribeLoadBalancerTraffic", req, cb);
    }
    async DescribeCrossTargets(req, cb) {
        return this.request("DescribeCrossTargets", req, cb);
    }
    async DescribeTargetHealth(req, cb) {
        return this.request("DescribeTargetHealth", req, cb);
    }
    async ManualRewrite(req, cb) {
        return this.request("ManualRewrite", req, cb);
    }
    async ModifyFunctionTargets(req, cb) {
        return this.request("ModifyFunctionTargets", req, cb);
    }
    async DeleteLoadBalancerSnatIps(req, cb) {
        return this.request("DeleteLoadBalancerSnatIps", req, cb);
    }
    async ModifyLoadBalancerMixIpTarget(req, cb) {
        return this.request("ModifyLoadBalancerMixIpTarget", req, cb);
    }
    async CreateRule(req, cb) {
        return this.request("CreateRule", req, cb);
    }
    async ModifyDomain(req, cb) {
        return this.request("ModifyDomain", req, cb);
    }
    async InquiryPriceRenewLoadBalancer(req, cb) {
        return this.request("InquiryPriceRenewLoadBalancer", req, cb);
    }
    async DescribeLoadBalancerOverview(req, cb) {
        return this.request("DescribeLoadBalancerOverview", req, cb);
    }
    async DeleteLoadBalancer(req, cb) {
        return this.request("DeleteLoadBalancer", req, cb);
    }
    async InquiryPriceCreateLoadBalancer(req, cb) {
        return this.request("InquiryPriceCreateLoadBalancer", req, cb);
    }
    async DeleteRule(req, cb) {
        return this.request("DeleteRule", req, cb);
    }
    async DescribeTaskStatus(req, cb) {
        return this.request("DescribeTaskStatus", req, cb);
    }
    async DescribeTargetGroupList(req, cb) {
        return this.request("DescribeTargetGroupList", req, cb);
    }
    async DescribeRewrite(req, cb) {
        return this.request("DescribeRewrite", req, cb);
    }
    async DescribeTargetGroups(req, cb) {
        return this.request("DescribeTargetGroups", req, cb);
    }
    async ModifyTargetGroupAttribute(req, cb) {
        return this.request("ModifyTargetGroupAttribute", req, cb);
    }
    async CreateClsLogSet(req, cb) {
        return this.request("CreateClsLogSet", req, cb);
    }
    async DescribeQuota(req, cb) {
        return this.request("DescribeQuota", req, cb);
    }
    async CreateLoadBalancer(req, cb) {
        return this.request("CreateLoadBalancer", req, cb);
    }
    async DescribeIdleLoadBalancers(req, cb) {
        return this.request("DescribeIdleLoadBalancers", req, cb);
    }
    async RegisterTargets(req, cb) {
        return this.request("RegisterTargets", req, cb);
    }
    async DescribeClassicalLBListeners(req, cb) {
        return this.request("DescribeClassicalLBListeners", req, cb);
    }
    async ReplaceCertForLoadBalancers(req, cb) {
        return this.request("ReplaceCertForLoadBalancers", req, cb);
    }
    async DeleteLoadBalancerListeners(req, cb) {
        return this.request("DeleteLoadBalancerListeners", req, cb);
    }
    async DeleteTargetGroups(req, cb) {
        return this.request("DeleteTargetGroups", req, cb);
    }
    async DescribeLoadBalancerListByCertId(req, cb) {
        return this.request("DescribeLoadBalancerListByCertId", req, cb);
    }
    async ModifyDomainAttributes(req, cb) {
        return this.request("ModifyDomainAttributes", req, cb);
    }
    async DisassociateTargetGroups(req, cb) {
        return this.request("DisassociateTargetGroups", req, cb);
    }
    async DescribeLoadBalancers(req, cb) {
        return this.request("DescribeLoadBalancers", req, cb);
    }
    async DescribeBlockIPList(req, cb) {
        return this.request("DescribeBlockIPList", req, cb);
    }
    async DescribeClassicalLBTargets(req, cb) {
        return this.request("DescribeClassicalLBTargets", req, cb);
    }
    async CreateListener(req, cb) {
        return this.request("CreateListener", req, cb);
    }
    async DescribeLBOperateProtect(req, cb) {
        return this.request("DescribeLBOperateProtect", req, cb);
    }
    async DescribeClsLogSet(req, cb) {
        return this.request("DescribeClsLogSet", req, cb);
    }
    async ModifyTargetWeight(req, cb) {
        return this.request("ModifyTargetWeight", req, cb);
    }
    async CreateTargetGroup(req, cb) {
        return this.request("CreateTargetGroup", req, cb);
    }
    async DescribeTargets(req, cb) {
        return this.request("DescribeTargets", req, cb);
    }
    async MigrateClassicalLoadBalancers(req, cb) {
        return this.request("MigrateClassicalLoadBalancers", req, cb);
    }
    async DescribeClassicalLBHealthStatus(req, cb) {
        return this.request("DescribeClassicalLBHealthStatus", req, cb);
    }
    async CreateLoadBalancerSnatIps(req, cb) {
        return this.request("CreateLoadBalancerSnatIps", req, cb);
    }
    async DescribeTargetGroupInstances(req, cb) {
        return this.request("DescribeTargetGroupInstances", req, cb);
    }
    async CloneLoadBalancer(req, cb) {
        return this.request("CloneLoadBalancer", req, cb);
    }
    async BatchModifyTargetTag(req, cb) {
        return this.request("BatchModifyTargetTag", req, cb);
    }
}
