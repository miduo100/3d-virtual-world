# END USER LICENSE AGREEMENT (EULA)
# Virtual World Federation System
#
# Version: 2026-08-06
# Licensor: 济宁米多信息科技有限公司 ("Licensor")
# Contact: 888@miduo100.com
#
# BY USING THIS SOFTWARE, YOU AGREE TO BE BOUND BY THE TERMS OF THIS AGREEMENT.
# IF YOU DO NOT AGREE, DO NOT USE THE SOFTWARE.

---

## 1. DEFINITIONS

1.1 **"Software"** means the Virtual World Federation System, including all components, modules, libraries, documentation, and the VWFP v2.1 protocol.

1.2 **"VWFP"** means the Virtual World Federation Protocol v2.1, the proprietary communication protocol designed by Licensor, including all data formats, field naming conventions, API endpoint structures, error codes, and database schemas.

1.3 **"Networked Use"** means any of the following:
   (a) Making the Software accessible to others via an IP address or domain name;
   (b) Establishing federation connections with other worlds;
   (c) Engaging in secondary development of the Software for external sale.

1.4 **"Subscription"** means the paid license required to engage in Networked Use, as defined in Section 2.

1.5 **"Lapse"** means the period during which your Subscription is not active (i.e., you have not paid the renewal fee).

1.6 **"You"** means the individual or legal entity exercising rights under this Agreement.

---

## 2. GRANT OF LICENSE

### 2.1 Free Use (Local Personal Use Only)

Subject to the terms of this Agreement, Licensor grants you a non-exclusive, non-transferable, revocable, worldwide license to use the Software **free of charge**, provided that ALL of the following conditions are met:

(a) You use the Software solely for personal purposes on your local machine.

(b) You do NOT make the Software accessible to others via any IP address or domain name.

(c) You do NOT establish federation connections with any other world.

(d) You do NOT engage in secondary development of the Software for external sale.

(e) You do not remove, obscure, or alter any copyright notices, watermarks, patent notices, or attribution included in the Software.

If any of conditions (a) through (d) is NOT met, you MUST obtain a Subscription License under Section 2.2.

### 2.2 Subscription License (Required for Networked Use)

If you engage in any Networked Use as defined in §1.3, you acknowledge that the Software is delivering networked value, and you agree to subscribe to support the continued development of the Software.

#### 2.2.1 First-Time Subscription

| Item | Fee |
|------|-----|
| First payment | CNY ¥60 (or USD $9.18) |
| Bonus | 2 months free after first payment |
| Thereafter | ¥3 per month per world |

#### 2.2.2 Monthly Renewal (Per World)

| Period | Fee (CNY) |
|--------|-----------|
| 1 month | ¥3 |
| 1 year (12 months) | ¥36 |
| 10 years | ¥360 |
| 100 years | ¥3,600 |

The subscription is per-world. If you operate multiple worlds, each world requires its own subscription.

#### 2.2.3 Lapse and Re-subscription

If your Subscription lapses (i.e., you stop paying the renewal fee), the following rules apply when you wish to re-subscribe:

| Lapse Duration | Re-subscription Fee |
|----------------|---------------------|
| Up to 12 months | CNY ¥3 per lapsed month (linear calculation) |
| More than 12 months (no matter how long) | CNY ¥60 (flat fee) |

**Examples:**
- Lapsed 1 month → pay ¥3 to re-subscribe
- Lapsed 3 months → pay ¥9 to re-subscribe
- Lapsed 6 months → pay ¥18 to re-subscribe
- Lapsed 12 months → pay ¥36 to re-subscribe
- Lapsed 13 months → pay ¥60 to re-subscribe
- Lapsed 5 years → pay ¥60 to re-subscribe

The maximum re-subscription fee is CNY ¥60, regardless of how long the lapse lasted beyond 12 months.

#### 2.2.4 Purpose of the Subscription Model

The subscription model is designed to support **long-term, sustained development** of this system. Licensor relies on the ongoing support of subscribers to continue improving the Software, fixing bugs, and developing new features. The low monthly fee (¥3) is intentionally affordable to encourage continuous support rather than one-time purchases.

### 2.3 Secondary Development for Sale

If you modify the Software and sell it to others (secondary development for external sale), you MUST:

(a) Maintain an active Subscription License (same fee structure as §2.2).

(b) Contact Licensor to obtain **written authorization** for the secondary development and sale.

(c) Provide appropriate attribution and feedback to the original author (Licensor).

(d) Comply with any additional terms set forth in the written authorization.

To obtain authorization: Contact 888@miduo100.com

---

## 3. VERSION DOWNLOAD RIGHTS

### 3.1 During Active Subscription

While your Subscription is active, you may:
(a) Download the latest version of the Software at any time.
(b) Install updates, patches, and new releases.
(c) Access the Licensor's download portal (if available).

### 3.2 After Subscription Lapse

Once your Subscription lapses:
(a) You may NOT download any new versions of the Software.
(b) The version you have already installed may continue to run on your server.
(c) You will not receive updates, patches, or new releases.
(d) To regain download access, you must re-subscribe according to §2.2.3.

### 3.3 Re-subscription and Version Access

Upon re-subscribing (paying the applicable fee per §2.2.3), you immediately regain the right to download the latest version of the Software available at that time.

---

## 4. PERMITTED USES

You MAY:

(a) Use the Software for personal purposes on your local machine (free, per §2.1).

(b) Use the Software for Networked Use with a valid Subscription (per §2.2).

(c) Modify the Software for your own internal use.

(d) Connect to other worlds using the VWFP protocol (requires Subscription).

(e) Create derivative works for your own use (requires Subscription if networked).

(f) Engage in secondary development for sale (requires Subscription + written authorization, per §2.3).

---

## 5. RESTRICTIONS

You MAY NOT:

(a) Remove or obscure any copyright notices, patent notices, or embedded watermarks.

(b) Redistribute, sublicense, rent, or lease the Software without a separate OEM license from Licensor.

(c) Reverse engineer, decompile, or disassemble the Software for the purpose of creating a competing product.

(d) Engage in Networked Use without a valid Subscription.

(e) Download new versions of the Software after your Subscription has lapsed.

(f) Claim or imply compatibility with VWFP v2.1 without Licensor's written certification.

(g) Use Licensor's trademarks, logos, or trade names without prior written permission.

---

## 6. INTELLECTUAL PROPERTY RIGHTS

6.1 The Software, including but not limited to:
- The VWFP v2.1 protocol design
- All data format specifications
- API endpoint structures and naming conventions
- Field naming conventions (e.g., "fromWorld", "characterConfig", "inventoryInfo")
- Error codes (e.g., "MISSING_WORLD_ID", "UNTRUSTED_SOURCE_WORLD")
- Database schema designs (e.g., "is_central" field, "trusted_worlds" table)
- World ID generation format ("world_{timestamp}_{random}")
- All source code and documentation

are the exclusive intellectual property of Licensor, protected by:
- Copyright law (China Software Copyright Registration: pending)
- Patent law
- Trade secret law

6.2 Any implementation, in any programming language, that uses the data formats, field naming conventions, API endpoint structures, or error codes defined in VWFP v2.1, constitutes a derivative work and requires a license from Licensor.

6.3 The protocol design is protected independently of the source code implementation. Using different programming languages or variable names while maintaining the same protocol structure does not avoid infringement.

---

## 7. HONOR SYSTEM & NO MONITORING

7.1 Licensor respects your privacy. The Software does **NOT**:
- Collect or report usage statistics
- Monitor your data or user activity
- Track your subscription status
- Require online activation or periodic verification

7.2 This is an **honor-based system**. You agree to:

(a) Self-assess whether your usage qualifies as Free Use (§2.1) or requires a Subscription (§2.2).

(b) Proactively obtain a Subscription when your usage triggers Networked Use conditions.

(c) Proactively re-subscribe when your Subscription lapses and you wish to download new versions.

(d) Respond truthfully if Licensor contacts you regarding your usage.

7.3 Engaging in Networked Use without a valid Subscription constitutes a material breach of this Agreement.

---

## 8. HOW LICENSOR FINDS VIOLATIONS

8.1 Licensor does not actively monitor Software usage. However, networked worlds are typically:

(a) Publicly accessible via IP addresses or domain names.

(b) Listed in federation directories or connected to other worlds.

(c) Featured in marketing materials, social media, or press releases.

(d) Discussed in community forums or support channels.

8.2 Licensor may discover unlicensed Networked Use through:
- Public information (website URLs, federation connections)
- Community reports
- Product listings (app stores, marketplaces)
- Your own website and marketing materials
- Industry conferences and events

8.3 Upon discovering unlicensed Networked Use, Licensor will:

(a) Contact you via email for a friendly discussion (30-day notice).

(b) Offer you the opportunity to obtain a Subscription License.

(c) If you refuse, pursue legal remedies as described in §9.

---

## 9. LIABILITY FOR BREACH

### 9.1 Payment of Unpaid Subscription Fees

If you breach this Agreement by engaging in Networked Use without a valid Subscription, you shall pay to Licensor **all unpaid Subscription fees** retroactively, calculated based on the actual duration of your unlicensed Networked Use.

### 9.2 Enforcement Costs

In addition to the unpaid Subscription fees under §9.1, you shall **bear all reasonable costs incurred by Licensor** in enforcing this Agreement and protecting its intellectual property rights, including but not limited to:

(a) Attorney's fees and legal service fees;

(b) Notarization fees and evidence preservation costs;

(c) Investigation and evidence collection costs;

(d) Court costs and litigation filing fees;

(e) Arbitration fees and arbitration institution charges;

(f) Travel and accommodation expenses directly related to enforcement;

(g) Any other reasonable expenses incurred in the course of rights protection.

### 9.3 Intellectual Property Infringement

Nothing in this Section shall limit Licensor's right to pursue claims for intellectual property infringement under applicable law, including but not limited to:

(a) Copyright infringement claims under the Copyright Law of the People's Republic of China.

(b) Patent infringement claims under the Patent Law of the People's Republic of China.

(c) Unfair competition claims under the Anti-Unfair Competition Law of the People's Republic of China.

(d) Punitive damages for intentional infringement with serious circumstances, pursuant to Article 1185 of the Civil Code of the People's Republic of China.

### 9.4 Public Disclosure

Licensor may publicly disclose your breach on its website ("Non-Compliant Users" page), including your company name and the nature of the violation, provided that Licensor has first contacted you and given you a reasonable opportunity to cure the breach.

### 9.5 No Liquidated Damages

The parties acknowledge that this Agreement does not impose fixed liquidated damages. The remedies available to Licensor are limited to:

(a) Recovery of unpaid Subscription fees (§9.1);

(b) Reimbursement of enforcement costs (§9.2);

(c) Statutory remedies for intellectual property infringement (§9.3).

This approach ensures that the remedies are proportionate to the actual harm caused and are fully enforceable under the laws of the People's Republic of China.

---

## 10. EVIDENCE OF OWNERSHIP

10.1 Licensor has and will maintain the following evidence of ownership:

| Evidence Type | Description |
|---------------|-------------|
| Software Copyright | Registered with China Copyright Protection Center |
| Protocol Copyright | VWFP v2.1 protocol specification (separate copyright registration) |
| Timestamp Certification | Filed with www.tsa.cn (trusted timestamp authority) |

| Multi-Language Implementation | Node.js (2026-03-15) + Python (2026-06-09) |
| GitHub Repository | Public commit history with timestamps |
| Design Documents | Complete system design documentation |

10.2 This evidence is admissible in legal proceedings and may be used to establish:
- Prior art (the protocol design predates any infringing implementation)
- Original authorship
- Willful infringement (if the infringer had access to the Software)

---

## 11. TERMINATION

11.1 This Agreement is effective until terminated.

11.2 Licensor may terminate this Agreement if you breach any term. Upon termination, you must cease all use of the Software and destroy all copies.

11.3 If your Subscription lapses, this Agreement remains in effect for Free Use (§2.1) only. Networked Use rights are suspended until re-subscription.

11.4 The Intellectual Property (§6), Liability for Breach (§9), and Governing Law (§12) sections survive termination.

---

## 12. GOVERNING LAW & DISPUTE RESOLUTION

12.1 This Agreement shall be governed by and construed in accordance with the laws of the **People's Republic of China**, without regard to conflict of law principles.

12.2 Any dispute arising from or relating to this Agreement shall be resolved as follows:

(a) **Step 1 - Friendly Negotiation** (30 days): Both parties shall attempt to resolve the dispute through good-faith negotiation.

(b) **Step 2 - Mediation** (optional): Either party may request mediation through a mutually agreed mediator.

(c) **Step 3 - Arbitration**: If negotiation fails, the dispute shall be submitted to the **Beijing Arbitration Commission (BAC)** for binding arbitration in accordance with its rules. The arbitration shall be conducted in Beijing, China, in the Chinese language. The arbitral award shall be final and binding on both parties.

(d) **Emergency Injunctive Relief**: Notwithstanding the above, Licensor may seek immediate injunctive relief from any court of competent jurisdiction to prevent irreparable harm to its intellectual property rights.

12.3 The prevailing party in any dispute shall be entitled to recover its reasonable legal fees and costs.

---

## 13. WARRANTY DISCLAIMER

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL LICENSOR BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY ARISING FROM THE USE OF THE SOFTWARE.

---

## 14. SEVERABILITY

If any provision of this Agreement is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that this Agreement shall otherwise remain in full force and effect.

---

## 15. ENTIRE AGREEMENT

This Agreement constitutes the entire agreement between you and Licensor regarding the Software and supersedes all prior agreements and understandings.

---

## 16. ACCEPTANCE

BY INSTALLING, COPYING, DOWNLOADING, ACCESSING, OR OTHERWISE USING THE SOFTWARE, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THE TERMS AND CONDITIONS OF THIS AGREEMENT.

IF YOU DO NOT AGREE TO THESE TERMS, DO NOT INSTALL OR USE THE SOFTWARE.

---

## 17. SUBSCRIPTION FEE QUICK REFERENCE

| Item | CNY | USD |
|------|-----|-----|
| First payment (2 months free, then ¥3/mo) | ¥60 | $9.18 |
| Monthly renewal (per world) | ¥3/month | — |
| Annual renewal (per world) | ¥36/year | — |
| 10-year renewal | ¥360 | — |
| 100-year renewal | ¥3,600 | — |
| Re-subscribe (lapse ≤12 months) | ¥3 per lapsed month | — |
| Re-subscribe (lapse >12 months, any duration) | ¥60 | $9.18 |

**Note:** The subscription model exists to support long-term, sustained development of this system. We need your continuous, ongoing support.

---

**Last Updated**: August 6, 2026
**Licensor**: 济宁米多信息科技有限公司
**Contact**: 888@miduo100.com
**Website**: https://miduo100.com

---

© 2026 济宁米多信息科技有限公司. All Rights Reserved.
VWFP is a trademark of 济宁米多信息科技有限公司.
