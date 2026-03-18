/**
 * Semantic Topic Classifier — Embedding-based sensitivity detection
 *
 * Closes the gap where regex/keyword matching misses semantically sensitive
 * content expressed in casual language. Uses pre-computed topic embeddings
 * derived from the full 508-scenario training corpus across 7 industries.
 *
 * How it works:
 * 1. On extension load, a small embedding model (~23MB, ONNX) is loaded
 *    into a Web Worker via ONNX Runtime Web or Transformers.js
 * 2. Pre-computed cluster centroids (average embeddings for each sensitive
 *    topic) are loaded from a static JSON asset
 * 3. At runtime, the user's prompt is embedded and compared via cosine
 *    similarity against each cluster
 * 4. If similarity exceeds the threshold for any cluster, a score boost
 *    is applied — even when no regex patterns or keywords matched
 *
 * Seeds are sourced from the IronGate training corpus:
 * - 508 labeled examples across 11 topic clusters
 * - 7 industries: finance, legal, healthcare, tech, IB, general, tech enterprise
 * - Mix of formal/structured and casual/natural language variants
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TopicCluster {
  category: string;
  label: string;
  /** Pre-computed centroid embedding (average of seed embeddings) */
  centroid: number[] | null;
  /** Similarity threshold to trigger (0-1) */
  threshold: number;
  /** Score contribution when triggered */
  scoreBoost: number;
  /** Seed sentences used to compute the centroid */
  seeds: string[];
}

export interface SemanticMatch {
  category: string;
  label: string;
  similarity: number;
  scoreBoost: number;
}

export interface SemanticClassification {
  matches: SemanticMatch[];
  totalBoost: number;
  topCategory: string | null;
}

/**
 * Adapter interface for embedding models.
 * Implementations can use ONNX Runtime Web, Transformers.js, or a local API.
 */
export interface EmbeddingAdapter {
  /** Whether the model is loaded and ready */
  isReady(): boolean;
  /** Embed a single text string into a fixed-size vector */
  embed(text: string): Promise<number[]>;
  /** Embed multiple texts (batch) */
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ── Topic Clusters ───────────────────────────────────────────────────────────
// IMPORTANT: All company names, person names, and financial figures in the
// seed sentences below are ENTIRELY FICTIONAL. They are synthetic training
// data created for embedding similarity. Any resemblance to real entities
// is purely coincidental.

export const TOPIC_CLUSTERS: TopicCluster[] = [
  {
    category: 'ma_deal',
    label: 'M&A / Acquisitions',
    centroid: null,
    threshold: 0.55,
    scoreBoost: 30,
    seeds: [
      'We\'re structuring a joint venture for a client in the renewable energy sector. What are the typical governance provisions?',
      'Preparing the going concern disclosure: Luminos Global Partners\' debt-to-equity ratio has reached 8.5x, cash reserves are down to $45M (approximately 60 days of operating expenses), and we have a $500M ',
      'The preliminary EBITDA for the quarter is tracking 6% below consensus estimates. We need to evaluate whether to issue a pre-announcement or wait for the earnings call.',
      'Zephyron Industries board has voted to file for Chapter 11 bankruptcy. The filing is scheduled for next Monday. Theron Ashford needs us to prepare the DIP financing agreement with Novalith Capital for $',
      'Investor allocation memo: The $1.5B senior secured offering for Titan Healthcare priced at T+325bps, inside of initial talk. Final book was $6.2B across 187 accounts. Top allocations: Blackmoor Investments 12%, Welli',
      'Covenant package for the $2.1B TLB financing Project Granite: Max net leverage 6.25x stepping down to 5.5x by Year 3. Interest coverage floor 2.0x. CapEx basket at $75M. Restricted payments basket 50%',
      'Project Atlas: The LBO model for Vexilis Software shows sponsor returns of 2.8x MOIC and 24% IRR at the base case entry multiple of 12.5x LTM EBITDA. Debt package is 5.5x first lien / 1.5x second lie',
      'Emergency board memo: Granite Point Capital\'s prime broker, Dunmore Securities successor entity, has issued a termination notice on our $4B prime brokerage agreement effective in 30 days. We need to migrat',
      'Aurelian Dynamics\' Q2 earnings will miss analyst consensus by 40%. Daxon Merriweather plans to announce a restructuring simultaneously to distract from the miss. Lisa Nakamura leaked this to three h',
      'Consolidation adjustment needed: The acquisition of DataVault Corp by Silverstream Technologies closed yesterday. Purchase price allocation shows $180M in goodwill, $95M in identified intangibles (cus',
      'Elara Voss from Novalith Capital just informed us that their board voted to pursue a hostile takeover of Quartzite Mining Corp at $45 per share. Current market price is $31. This information is strictly c',
      'The partner deal registration for Luminos Consulting\'s Federal Health IT practice: they\'re bringing us into the VA Electronic Health Record modernization program. Estimated deal size: $18.4M over 7 years. Key ',
      'Venture Equity Partners is launching a tender offer for 51% of Magellan Corp at $44 per share, representing a 28% premium. They plan to follow with a short-form merger at the same price. The 14D-9 nee',
      'Confidential restructuring plan: We\'re planning to lay off 2,200 employees (30% of workforce) across all divisions of Consolidated Pacific Industries. The restructuring charge will be approximately $1',
      'Project Granite amendment: Following the covenant breach discussion, the lender group has agreed to a waiver and amendment package. Key terms: (1) leverage covenant reset to 6.75x for Q1-Q2, stepping ',
      'Pyraxion Holdings\' board has authorized us to engage with three potential acquirers. The ask is $3.8B, representing 14x LTM EBITDA. We cannot approach Zephyron Industries due to the antitrust overlap.',
      'I\'m preparing the insider trading analysis for the SEC investigation. CEO Robert Thornton of Zephyron BioSciences sold 500,000 shares at $45.20 on March 3rd, exactly two weeks before the company annou',
      'Our DCF model for the renewable energy division implies a standalone valuation 30% above the current conglomerate trading value. The board is considering a spin-off announcement next month.',
      'My channel check contact at Vertex Semiconductor, supply chain manager Robert Kim, just told me that the company is about to announce a major product recall affecting $200M in shipped inventory. He se',
      'We\'re working on an LBO of a healthcare staffing company. The seller (Legacy Healthcare Staffing, owned by Crestline Partners, entry 2018 at $420M valuation) is exiting at $1.8B valuation (4.3x entry mul',
      'NovaTech Inc IPO: Books are 8.2x oversubscribed at the midpoint of $28-$32. Northgate Investments wants 15% of the deal, Ridgemont Asset Management is in for 12%. We\'re recommending pricing at $34, above range. Greenshoe is 4.5M s',
      'Clearwater Systems\' founder wants to sell 100% of the business. We\'re targeting a $600M-$700M valuation range based on 10x-12x the $62M adjusted EBITDA. First round bids are due April 5th. The teaser ',
      'Project Silverstone consortium update: The minority stake sale in Novalith Racing Technologies has attracted a consortium bid from RedBird Capital and the Saudi Public Investment Fund. Combined offer: $1.',
      'The M&A scenario planning: if NovaSoft acquires us (rumored $400M offer through Whitfield Securities banker Patricia Lee), our enterprise customers would be migrated to NovaSoft\'s platform within 18 months.',
      'I\'m building the CIM for Project Redwood. The target, Greenfield Organics, has shown 18% revenue CAGR over the last five years with EBITDA growing from $22M to $58M. The CEO, Michael Torres, will need',
      'We\'re advising on a minority stake acquisition in a European AI SaaS startup (CodePulse AI). The lead investor is planning to invest $200M for an 18% stake at a post-money valuation of $1.1B. CodePuls',
      'Draft a clawback demand letter to former Vexilis Biotech CEO Lyria Wentworth for $4.8 million in performance-based compensation. The compensation was based on clinical trial milestones that we now kn',
      'We\'re working on a cross-border transaction and need to assess withholding tax implications for the client\'s European subsidiaries.',
      'Crestview Partners and Thornveil Energy merger update: The HSR waiting period expires next Tuesday. Solara Quintero from FTC staff indicated informally that no second request is forthcoming. Deal closi',
      'Our channel partner strategy targets 30% of enterprise revenue through partners by 2026. Current partnerships: Vexilis Advisory (3 joint deals worth $8.2M), Luminos Consulting (1 deal, $2.1M, stuck in procurement), an',
      'Harborview Capital has indicated they can go up to 6.5x leverage on Project Titan, with a $1.2B equity check. Their base case assumes 22% IRR with a 5-year hold and exit at 11x EBITDA. Can you stress-',
      'Project Nighthawk update: Zephyron Holdings has agreed to exclusivity through March 28. Their board authorized a bid range of $74-$82 per share, representing a 28-35% premium to undisturbed price. The',
      'The PIPE for Arcadian Technologies\' de-SPAC is oversubscribed. Ashbrook Asset Management and Northgate Investments are anchoring at $10 per share with full ratchet anti-dilution. Total PIPE size is $250M against a $1.8B pro form',
      'Project Horizon PIPE update: The $350M PIPE for Vanguard Fintech\'s SPAC merger with Nexus Payments is anchored by Harbridge Capital ($150M) and Pinecrest Advisors ($100M). Remaining $100M from family offices. ',
      'Project Horizon update call with the special committee: The go-shop period expires in 12 days. Two potential topping bidders have entered the data room—Oakmere Holdings and a strategic we\'ve codenamed \'Part',
      'MegaCorp and Atlas Industries are in advanced merger discussions. The deal would value Atlas at $8.7B with a 35% premium to current trading price. Our M&A team is advising MegaCorp. The board vote is ',
      'We\'re working on a leveraged recap where the existing private equity sponsor is taking cash out at a 4x multiple. Debt/EBITDA will rise from 2.8x to 4.1x post-transaction. The target company is a nich',
      'Elara Voss\'s privileged memo outlines Novalith Capital\'s plan to acquire a 15% stake in Quartzite Mining Corp through a series of shell companies to avoid triggering the 13D filing requirement. Total inve',
      'Our sales pipeline for Q2 includes: Novalith Manufacturing ($2.3M TCV, 70% probability), ClearView Analytics ($1.8M TCV, 40% probability), and Federal Systems Group ($4.1M TCV, 25% probability). We need t',
      'IPO valuation for Project Aurora (CloudScale Inc): Based on the rule of 40 (revenue growth + FCF margin = 52), we\'re arguing for a premium multiple. Comparable SaaS companies trade at 12-18x NTM reven',
      'Novalith Capital\'s forensic accountant found that Quartzite Mining Corp inflated EBITDA by $67 million through improper capitalization of exploration costs. This was not disclosed in the merger due diligence',
      'We represent a software company that\'s exploring an acquisition of a smaller SaaS platform. The target\'s ARR is $25M growing 35% annually. Our client\'s ARR is $185M growing 22%. We\'re trying to decide',
      'Privileged memo: Novalith Capital\'s board is considering spinning off its cryptocurrency division. Elara Voss estimates the division is worth $320 million. The spin-off would allow Apex to avoid SEC sc',
      'Covenant-lite term sheet for Project Summit: The borrower (Ascend Logistics) is pushing for no financial maintenance covenants on the $2.4B TLB. Given the current CLO demand, we think the market will ',
      'M&A confidential: We\'re in advanced talks to acquire Prism Analytics for $28M. Their technology would give us a competitive edge in real-time data processing. Due diligence findings: they have $3.2M A',
      'Confidential deal update: Zephyron Industries and Stellarion Aerospace have agreed to a patent cross-licensing deal worth $75 million over five years. Theron Ashford and Tessara Ling are the princi',
      'I\'m hearing that several large-cap tech companies are looking at transformative acquisitions in the AI infrastructure space. What valuation frameworks should we be pitching to position ourselves for t',
      'The event-driven strategy team at Vexilis Asset Management has built a $200M position in Celestial Media ahead of the expected takeover bid from Vanguard Broadcasting. The position was accumulated ov',
      'The target\'s management projections for Project Diamond look aggressive. Revenue CAGR of 25% over five years vs. 12% industry average. EBITDA margins expanding 800bps with no clear driver. Our indepen',
      'Project Zenith: Cross-border acquisition of Müller Maschinenbau GmbH (Munich) by Precision Industrial Corp (Chicago). EUR 1.2B purchase price. German regulatory approval (Bundeskartellamt) obtained. C',
    ],
  },
  {
    category: 'legal_strategy',
    label: 'Litigation Strategy',
    centroid: null,
    threshold: 0.55,
    scoreBoost: 25,
    seeds: [
      'Luminos Financial Group\'s internal probe found that Corvin Hale used his personal trading account (Clearmont #4478-2291) to front-run three client trades totaling $12 million. We need to self-report to FI',
      'A nonprofit client is restructuring its board governance. What fiduciary duty considerations apply to nonprofit directors?',
      'Luminos Financial Group client Corvin Hale\'s personal bankruptcy filing shows assets of $2.1 million and liabilities of $47 million. His Cayman Islands account at First Caribbean Bank (#CT-88432) was n',
      'Our client Zephyron Health Systems is acquiring TechCorp Inc for approximately $340 million. The due diligence uncovered a pending FDA investigation into their flagship device that has not been disclo',
      'Summit Ventures board resolution draft: Authorize payment of $15 million to Fenwick Crane as severance upon resignation. He will cooperate fully with the SEC investigation and waive his right to co',
      'Diana Reeves has retained outside counsel and is threatening to sue Vanguard Realty for wrongful termination and defamation. She claims the self-dealing allegations were fabricated by board member Jam',
      'Prepare trial exhibits for Thornveil Energy v. Orbivex Holdings. Victoria Langley will testify that Tobias Runell at TerraFirma personally destroyed emails related to the pipeline contamination bet',
      'I\'m working on a case involving environmental contamination at a manufacturing site. What expert witnesses are typically retained for groundwater analysis?',
      'ATTORNEY-CLIENT PRIVILEGED: Tessara Ling at Stellarion Aerospace has informed us that the company discovered falsified safety inspection records at their Tucson facility. Three employees, including p',
      'Our ethics committee is concerned that Partner Williams may have a conflict of interest because his wife sits on the board of TargetCo, which is the opposing party in the Baxter litigation. Research t',
      'Work product: Analysis of potential RICO claims against Vexilis Biotech executives. Lyria Wentworth and Kellan Varek formed what appears to be an enterprise to defraud investors through systematic',
      'I\'m reviewing potential conflicts of interest before our firm takes on a new matter in the energy sector. What screening procedures should we follow?',
      'Ironwood Manufacturing workers\' compensation claims: 47 employees at the Ohio plant have filed claims for respiratory illness. Tobias Runell kept a personal log documenting unsafe conditions that Amand',
      'Confidential: Eastpoint Media is under investigation by the California AG for violations of CCPA. Grace Holloway deleted customer data requests logs before the investigation was announced. We need to ',
      'Aurelian Dynamics has agreed to a consent decree with the SEC. Daxon Merriweather will pay a $3 million personal fine and be barred from serving as an officer or director of any public company for f',
      'Update on Orbivex Holdings v. Quartzite Mining Corp: Solara Quintero\'s deposition revealed that Cobalt\'s environmental reports were doctored to hide mercury contamination levels. We need to file supplem',
      'Zephyron Industries just received a target letter from the SDNY US Attorney\'s office. The investigation involves Theron Ashford and three other executives for conspiracy to commit securities fraud. ',
      'A client in the transportation industry wants to challenge a new DOT regulation. What are the administrative law avenues available?',
      'Pacific Rim Trading has offered to cooperate with the DOJ investigation into Silverline Logistics\' price-fixing scheme. Their CEO Robert Chen will provide testimony implicating Marcus Thompson and two',
      'The mediation in the Reynolds matter is scheduled for March 15. Our bottom line is $750K but we\'ll open at $1.5M. The mediator is Judge Chen who tends to push toward the midpoint. Prepare a mediation ',
      'Eastpoint Media is negotiating a consent order with the FTC regarding deceptive advertising practices. Grace Holloway proposes paying a $22 million fine and implementing a 10-year compliance monitorin',
      'PRIVILEGED: Brookfield Industries board member Amanda Sterling has a personal relationship with opposing counsel in the Ironwood case. This creates a potential conflict. We need to assess whether she ',
      'A client in the gaming industry needs guidance on compliance with the new state sports betting regulations.',
      'Privileged trial strategy: In the Brookfield v. Ironwood case, we plan to call Amanda Sterling last to create maximum emotional impact. Her testimony about the workers\' health effects from toxic expos',
      'Brookfield Industries discovered that Ironwood Manufacturing\'s environmental liability reserves were understated by $60 million. Fenwick Crane at Ironwood approved the understated figures knowing t',
      'Privileged memo: Novalith Capital\'s board is considering spinning off its cryptocurrency division. Elara Voss estimates the division is worth $320 million. The spin-off would allow Apex to avoid SEC sc',
      'Silverline Logistics settlement with Pacific Rim Trading: $45 million payment, mutual release, and cooperation agreement. Marcus Thompson will resign as CEO. The DOJ has approved the terms. Elena Vasq',
      'The settlement agreement in Docket No. 2023-1847 includes a confidentiality clause at Section 8.2. The opposing party breached it by discussing terms with the Wall Street Journal. Draft a motion for c',
      'Sterling Healthcare\'s former nurse practitioner Amanda Sterling is prepared to testify that patient records were altered to conceal post-surgical complications. Dr. Marcus Thompson personally directed',
      'We\'re evaluating potential Section 220 demand for books and records on behalf of a minority shareholder client.',
      'Aurelian Dynamics\' internal investigation revealed that Daxon Merriweather maintained a personal email account (r.fontaine.private@protonmail.com) to communicate with co-conspirators about the stock',
      'Prepare the voluntary disclosure to the SEC regarding Helixtara Pharmaceuticals\' revenue recognition issues. Kellan Varek estimates the restatement will reduce reported revenue by $92 million over t',
      'Quartzite Mining Corp\'s board member Kavita Neroshan sold 200,000 shares at $42 each three days before the announcement of the environmental contamination. Her broker at Haverford Wealth flagged the trades. Th',
      'We\'re advising a real estate developer on zoning challenges for a mixed-use project. What are the typical variance application strategies?',
      'Helixtara Pharmaceuticals wants us to negotiate the licensing deal with Vexilis Biotech for the RSTP-440 compound. Kellan Varek from Helixtara says they\'ll pay up to $200 million upfront plus 8% roy',
      'Theron Ashford from Luminos Financial Group called about the SEC inquiry. They have not yet received a Wells Notice, but the enforcement division is asking about the CDO transactions from Q4 2024. Total',
      'I\'m preparing for a deposition of the opposing party\'s expert in a medical malpractice case. What areas should I focus on for impeachment?',
      'Novalith Capital\'s forensic accountant found that Quartzite Mining Corp inflated EBITDA by $67 million through improper capitalization of exploration costs. This was not disclosed in the merger due diligence',
      'Our aerospace client is facing a qui tam action under the False Claims Act. What are the typical defense strategies at the initial stage?',
      'Witness prep notes: William Exeter should avoid mentioning his prior felony conviction for wire fraud during his testimony in the Zephyron Industries case. We\'ll address it on direct if opposing cou',
      'The documents produced in discovery batch 14 show that the defendant\'s VP of Engineering sent an email on June 3, 2023 saying \'we know the brake system has a flaw but fixing it would delay the launch ',
      'Brookfield Industries\' IP counsel Fenwick Crane discovered that a competitor, Ironwood Manufacturing, has filed a patent application that appears to be based on trade secrets stolen by former Brook',
      'Luminos Financial Group\'s compliance team found that the CDO portfolio managed by Corvin Hale contains $430 million in subprime mortgage-backed securities rated AAA by a conflicted rating agency. This ',
      'Our insurance client has a coverage dispute involving a cyber incident. Outline the typical arguments for and against coverage under a CGL policy.',
      'Work product: Litigation risk assessment for Vexilis Biotech\'s board. If the securities fraud class action proceeds to trial, our estimate of adverse judgment is $500 million to $750 million. Sarah W',
      'Our client, a mid-size bank, needs to update its BSA/AML compliance program. What are the current regulatory expectations?',
      'Stellarion Aerospace contract update: The Pentagon has agreed to a $2.8 billion renewal contingent on Stellarion resolving the safety inspection issues. Kellan Varek at DOD wants a compliance certifi',
      'Luminos Financial Group\'s internal investigation found that three traders, including Corvin Hale, executed wash trades to inflate the price of synthetic CDOs. Total artificial volume was approximately ',
      'Helixtara Pharmaceuticals opioid case: Kellan Varek\'s personal text messages show he knew about the addiction risks of OxyHelixtara as early as 2022 but directed marketing to downplay them. These tex',
      'Draft a clawback demand letter to former Vexilis Biotech CEO Lyria Wentworth for $4.8 million in performance-based compensation. The compensation was based on clinical trial milestones that we now kn',
    ],
  },
  {
    category: 'financial_intel',
    label: 'Financial Intelligence / MNPI',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 30,
    seeds: [
      'The quarterly investor update includes: 1) Net revenue retention: 112% (down from 128% last quarter), 2) New logo acquisition: 12 customers ($8.4M new ARR), 3) Expansion revenue: $3.2M from 34 existin',
      'The RFP from Sterling Financial requires us to demonstrate our multi-region failover capabilities. Our current failover time is 8 minutes which doesn\'t meet their 2-minute RTO requirement. We\'re plann',
      'The Harrington Endowment Fund, managed by director Susan Park, is redeeming its entire $95M allocation from our global macro strategy. She\'s asked us to wire the proceeds in three tranches: $40M on Ap',
      'We\'re structuring a secondary buyout where Thorngate Global Management is acquiring a 65% stake in Ascent Holdings from Stellar Capital Partners for $1.85B. Stellar originally invested $280M equity 6 yea',
      'Our systematic equity strategy has a current gross exposure of $1.8B with a net long bias of 35%. The factor tilts are primarily in value and quality. Prepare the monthly investor letter draft.',
      'The liquidity coverage ratio for Silverline Bancorp has fallen to 85%, below the 100% regulatory minimum. The primary driver is the $2B outflow of uninsured deposits following the credit rating downgr',
      'The comparable company analysis for the potential acquisition target shows it trading at a 25% discount to peers on EV/EBITDA. Draft the preliminary valuation section for the pitch book.',
      'The intellectual property audit for Project Titan revealed that 30% of the codebase uses open-source libraries with GPL licenses, which conflicts with our commercial licensing model. The estimated cos',
      'Ironwood Partners is structuring a $500M PIPE to support their acquisition of Brightpath Digital. The PIPE terms include a 15% discount to the 10-day VWAP, registration rights within 30 days, and a 12',
      'Elder financial exploitation alert: Account holder Dorothy Patterson, age 87, account PAT-22019, has been making unusual large withdrawals totaling $340K over the past month. Her grandson, Tyler Patte',
      'Transaction monitoring flagged an unusual pattern of just-below-threshold cash deposits across multiple branches totaling $890K over two weeks. We need to assess whether this constitutes structuring.',
      'Blackwood Capital is executing a short squeeze defense for our $150M short position in Quantum Dynamics. We need to borrow an additional 2M shares to cover the potential buy-in. Our prime broker at Mo',
      'Our internal benchmarks show that our managed Kubernetes offering has 99.92% control plane uptime, which is below AWS EKS (99.95%) and GKE (99.95%). The main cause is etcd leader election storms durin',
      'The SOX compliance issue: our revenue recognition for 3 enterprise contracts is under review. The contracts with Novalith Financial ($1.9M), Sterling Insurance ($4.7M), and Quantum Analytics ($3.1M) have ',
      'I\'m implementing the new event sourcing system for Project Solaris. Our current write-ahead log processes 500K events per minute but we need to handle 2M for the enterprise tier launch next quarter.',
      'Project Falcon syndication update: Westmark Capital and Dunmore Securities are co-leading the $800M TLB. Pricing is SOFR + 425 with a 99 OID. Commitments from CLO managers are soft and we may need to flex up to SO',
      'Workforce planning model for the layoff scenario analysis: If we reduce engineering by 30% (84 people), annual savings would be $24M but we\'d lose capacity to maintain 3 product lines. The affected pr',
      'Summit Ventures\' pre-IPO audit revealed that Kavita Neroshan approved $18 million in related-party transactions that were not properly disclosed. The underwriters at Sterling Meridian need to be informed, but doin',
      'The internal investigation at Summit Ridge Partners confirmed that managing partner Andrew Lawson has been personally guaranteeing loans using fund assets as collateral without LP consent. He pledged ',
      'Quarterly rebalancing for institutional client New York State Teachers\' Retirement Fund, account NYSTRF-00142, AUM $450M. Increase US equity allocation from 40% to 45% ($22.5M buy), reduce internation',
      'File SAR immediately: Customer account 88201445, holder name Victor Petrov, has received 23 international wire transfers from 8 different entities in Latvia, Estonia, and Lithuania totaling $4.7M over',
      'Data breach notification: An unauthorized third party accessed our client database through a compromised vendor portal. Approximately 28,000 client records were exfiltrated, including full names, SSNs',
      'The performance audit of our Kubernetes platform shows we\'re over-provisioned by approximately 40%. We\'re paying for 2,400 vCPUs but average utilization is only 34%. The estimated annual waste is $1.8',
      'The notification delivery pipeline in Project Hermes processes 15M push notifications daily. The current fanout architecture uses SNS to SQS with 8 consumer groups. Delivery latency p99 is 4.2 seconds',
      'Update the LBO sensitivity table for Project Phoenix: base case IRR is 21% at 6.5x entry and 8x exit multiple, with $3.2B of debt at SOFR+425. The management equity pool is 8% of fully diluted shares.',
      'The multi-cloud migration strategy for TransGlobal Logistics involves moving their Oraculum Systems workloads to PostgreSQL on our platform. Their current Oraculum Systems license costs $3.2M/year with Exadata hardware s',
      'Project Horizon PIPE update: The $350M PIPE for Vanguard Fintech\'s SPAC merger with Nexus Payments is anchored by Harbridge Capital ($150M) and Pinecrest Advisors ($100M). Remaining $100M from family offices. ',
      'Our headcount plan for 2025: hire 45 engineers (20 backend, 10 infrastructure, 8 ML, 7 frontend). Average fully-loaded cost is $285K per engineer. Total engineering budget is $38.4M including contract',
      'Summit Aerospace is being approached by both Aerolon Defense Systems and Tripoint Aerospace for a potential acquisition. Summit\'s CEO wants to explore a sale at no less than 16x forward EBITDA, which implies roughly $2',
      'Project Neptune board memo: Summarizing the three final bids received for OceanView Resorts. Bid A from Grandview Hospitality: $4.2B all-cash, no financing condition, 45-day close. Bid B from Crestview Hotels: $4.5B, 80% ca',
      'Urgent wire transfer authorization needed: Send $28M from Granite Point Capital operating account 2290-4455-8812 to escrow account at Wilson Sonsini, account 7744-2200-1188, reference: Project Evergre',
      'I need to optimize the query planner in our custom graph database engine, CodexDB. The current implementation does nested loop joins which is O(n*m) for cross-partition queries. We handle about 1.2 bi',
      'Our engineering team is evaluating whether to build our own container orchestration layer or continue with EKS. The annual EKS bill is $2.8M and we think a custom solution could save 40% but would req',
      'The tax team discovered that Harmon Industries has been claiming R&D tax credits on projects that don\'t qualify under Section 41. Controller Lisa Park approved $8.2M in fraudulent credits over three t',
      'The board is considering a 15% reduction in the dividend payout ratio next quarter to fund the cloud migration initiative. Help me model the impact on our share price.',
      'Urgent: Our real-time risk system shows that trader Daniel Kim on the rates desk has breached his $50M VaR limit. His current portfolio VaR is $78M due to a concentrated position in 30-year Treasury f',
      'We need to accelerate the goodwill impairment for the Ironbridge Consulting acquisition. The unit has lost 60% of its revenue base and the carrying value of $180M needs to be written down to approxima',
      'Pricing negotiation strategy for the Novalith Manufacturing renewal: Current contract $1.9M/year expiring in 45 days. They\'re requesting: 25% volume discount, custom SLA with $50K/incident penalty, unlimi',
      'Market manipulation alert: I\'ve noticed that trader Vincent Morales on the commodities desk has been placing and cancelling large orders in natural gas futures to create the appearance of demand befor',
      'Our customer data processing architecture violates the data processing agreements (DPAs) with 78 enterprise customers. Specifically: 1) We use customer data for ML model training without consent (clau',
      'Novalith Activist Partners has sent a private letter to the board of Riverside Consumer Products demanding a strategic review. They own 6.8% and threaten a public campaign if we don\'t engage within 30 day',
      'The proof of concept for Vertex Cloud\'s real-time analytics module showed our platform can process 4.2M events per second with sub-100ms query latency. However, when we tested with Horizon Financial\'s',
      'Our inventory obsolescence reserve methodology is under scrutiny from the external auditors. They believe we should increase the reserve by $4M based on aging analysis.',
      'Vanguard Therapeutics has received an unsolicited approach from BioNexus Corp at $65 per share. The board is considering a white knight defense and wants us to approach Provence Pharma Services and Kelvin Life Sciences. Kee',
      'Pyraxion Holdings\' board has authorized us to engage with three potential acquirers. The ask is $3.8B, representing 14x LTM EBITDA. We cannot approach Zephyron Industries due to the antitrust overlap.',
      'Luminos Financial Group\'s compliance team found that the CDO portfolio managed by Corvin Hale contains $430 million in subprime mortgage-backed securities rated AAA by a conflicted rating agency. This ',
      'We\'re designing a new sharding strategy for our user database. The current single-shard PostgreSQL instance holds 890M user records and is approaching the 4TB storage limit. We\'re considering hash-bas',
      'Client transition request: Dr. Amara Okafor, a Nigerian-American physician, account AOK-55012, is transferring her $8.5M portfolio from Haverford Wealth to our firm. ACAT transfer initiated. Her current ',
      'Project Quantum\'s architecture review revealed that our current database design won\'t scale beyond 50M users. We\'re at 34M now and growing 8% month-over-month. The re-architecture would cost approxima',
      'Our VaR model uses a 99th percentile confidence interval with a 10-day holding period. We assume equity-credit correlation of 0.65 and use a Monte Carlo simulation with 50,000 paths. The current portf',
    ],
  },
  {
    category: 'hr_workforce',
    label: 'HR / Workforce Changes',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 25,
    seeds: [
      'Andre Williams, Director of Engineering, has been accused of creating a hostile work environment. Five employees have filed complaints in the last quarter. His personnel file shows two prior written w',
      'Project Quartz update: The management team at Ridgeline Technologies is concerned about the proposed non-compete terms in the merger agreement. CEO Sarah Chen and CTO David Park are pushing for 12-mon',
      'We\'re evaluating whether to move Project Helix from our Austin office to the Bangalore team. What factors should I consider in the transition plan?',
      'We\'re planning to lay off 15% of engineering (about 45 people) next quarter to extend our runway to 18 months. The affected teams are platform infrastructure, QA, and the Berlin office. HR is preparin',
      'Year-end bonus discussion (confidential—MD committee only): The Americas M&A group generated $362M in net revenue against a $380M budget (95% attainment). Bonus pool is $145M, down 8% from last year. ',
      'Prepare termination documents for Aisha Khan, CFO. The board voted unanimously to remove her after discovering she authorized $14 million in undisclosed related-party transactions with Vertex Global, ',
      'We need to prepare a liquidation analysis as a baseline for the plan of reorganization. What\'s the standard approach for valuing hard assets versus intangibles in a Chapter 11 context?',
      'Kevin Park\'s disability accommodation request needs to be reviewed. He has submitted medical documentation for chronic fatigue syndrome and is requesting a modified work schedule. His SSN is 445-67-89',
      'Lakeshore Manufacturing\'s restructuring plan proposes a debt-for-equity swap where first lien holders recover 85 cents on the dollar and second lien holders get 40 cents plus warrants. The ad hoc grou',
      'Samantha Patel reported that her manager Brian Murphy has been requiring her to work off the clock on weekends, approximately 15 hours per week for the last 6 months. She\'s classified as non-exempt. B',
      'Tanya Volkov\'s immigration paperwork needs to be filed by Friday. Her H-1B visa expires on April 30. Her passport number is 7845123690, nationality Russian, DOB 09/23/1991. If the extension is denied,',
      'Our client\'s former CTO just joined their main competitor, Nexus Technologies, and we believe she took proprietary source code for the recommendation algorithm. The code is worth approximately $15M in',
      'Rachel Foster\'s annual compensation review: current salary $156,000, proposed increase to $172,000 (10.3%). She also has unvested stock options worth approximately $340,000. Her performance rating is ',
      'Prepare the PIP documentation for Samantha Patel. She has missed deadlines on three consecutive sprints and her code review rejection rate is 45%. If she doesn\'t improve within 60 days, we\'ll proceed ',
      'Can you help me draft a transition plan for when our Chicago office consolidates with the Detroit location? About 120 employees will be affected.',
      'Quantex Systems is acquiring our company for $1.2 billion. The deal closes in 45 days. We need to prepare retention packages for 50 key employees. Greg Hamilton and Tanya Volkov are on the critical re',
      'We\'re investigating a potential front-running pattern in trader ID 4821\'s activity. Between March and June, his personal account purchased shares in 12 of the 15 companies our fund later took position',
      'Prepare the RIF list for the upcoming layoffs. The following employees in the Dallas office are being eliminated: Samantha Patel (Senior Engineer, $142,000), Derek O\'Connor (Product Manager, $128,000)',
      'Internal investigation update: Chris Nakamura\'s laptop contained 4,200 files downloaded from the secure R&D server including schematics for Project Helix. He submitted his resignation the same day Bri',
      'We\'re planning to discontinue the legacy Polaris product line by Q4. Help me draft a customer migration timeline and communication plan.',
      'Our ethics committee is concerned that Partner Williams may have a conflict of interest because his wife sits on the board of TargetCo, which is the opposing party in the Baxter litigation. Research t',
      'I need to draft an internal memo about the proposed merger of the customer success and technical support departments under one VP.',
      'Brian Murphy filed a whistleblower complaint alleging that the finance team has been inflating revenue figures by $3.2 million per quarter through premature revenue recognition. The CFO Aisha Khan is ',
      'The plan support agreement for Bridgewater Media requires 66.7% of first lien holders to sign by March 20th. Timberland Capital and Stonebridge Advisors have committed representing 45% of the class. We need another $300M in ',
      'My performance review is coming up and my manager mentioned the rating scale is changing this cycle. Can you help me prepare a self-assessment?',
      'We\'re considering opening a new R&D center in Tel Aviv. Can you help me outline the business case including preliminary headcount and budget projections?',
      'The internal audit found that Pablo Reyes in procurement has been directing $2.8 million in contracts to a company owned by his brother-in-law. His employee file shows he passed the last three backgro',
      'In a distressed situation where the company has both first lien and second lien debt, how do you typically think about the fulcrum security analysis? What recovery rates are realistic for second lien ',
      'The salary equity audit found that female employees in the engineering department earn 14% less than male counterparts at the same level. Specific examples: Jennifer Liu earns $134,000 vs. Derek O\'Con',
      'URGENT: Derek O\'Connor\'s company laptop was stolen from his car last night. The laptop contained unencrypted files with 12,000 customer records including names, addresses, and credit card numbers. We ',
      'Please update the payroll records for Greg Hamilton. His new salary is $198,000 effective April 1. His direct deposit goes to Chase account ending in 4477. Also update his address to 2847 Elm Street, ',
      'Jennifer Liu in accounting reported that her manager Andre Williams has been making inappropriate comments about her appearance and sending unwanted personal messages. She wants to file a formal compl',
      'Tanya Volkov\'s exit interview revealed that Stratosphere Inc offered her a $50,000 signing bonus and a 30% salary increase. She also mentioned she\'s taking the client list and pricing models she built',
      'The annual employee engagement survey results show that morale in the engineering department is at 32% (company average 67%). The top complaints are: leadership doesn\'t listen, compensation is below m',
      'Draft the restructuring memo: The entire Customer Operations division (85 employees) will be eliminated and outsourced to Clearpoint Analytics effective June 1. Affected employees include three direct',
      'Maria Gonzalez has filed an EEOC complaint alleging age discrimination. She\'s 58 and was passed over for promotion in favor of Kevin Park, age 29, despite having 15 more years of experience and higher',
      'Helios Corp\'s Q4 financial results show revenue of $847 million, down 12% from projections. The board has decided to cut 400 positions across three divisions. This information is embargoed until the e',
      'Rachel Foster has been diagnosed with stage 3 breast cancer. She\'s requesting an extended leave of absence beyond the 12 weeks of FMLA. Her oncologist Dr. James Rivera recommends 6 months of treatment',
      'The DIP financing for Cascade Energy is being led by Granite Point Capital with a $300M super-priority facility. The pre-petition first lien group is objecting to the priming and the judge has set a hearing for Ma',
      'Three of our largest clients are redeeming a combined $180M at the end of the quarter. This will bring AUM below $2B for the first time. We need to cut two portfolio managers and close the small-cap s',
      'Kevin Park\'s I-9 verification flagged a potential document fraud issue. The SSN he provided (523-44-8876) appears to belong to another individual. Immigration counsel needs to review before we take an',
      'Monarch Holdings\' Chapter 11 plan includes a rights offering backstopped by Ravencrest Capital at $150M, giving them 40% of the reorganized equity. Existing equity holders are getting wiped out. The confi',
      'Our board voted yesterday to terminate the CEO effective immediately. The press release goes out tomorrow morning. The interim CEO is the current CFO, Maria Rodriguez. Draft talking points for the all',
      'CONFIDENTIAL: The board approved a stock buyback program of $500 million to be announced after the Q1 earnings call. Additionally, the CEO search committee has narrowed candidates to three external ca',
      'The background check for new hire Pablo Reyes revealed a felony conviction from 2018 that he did not disclose on his application. His offer letter for the Director of Finance role at $175,000 has alre',
      'Dana Wheeler requested FMLA leave for postpartum depression starting immediately. Her psychiatrist Dr. Elaine Marsh submitted documentation. Dana\'s team of 12 needs interim leadership. Her salary duri',
      'Our competitor Nexus Corp just lost their CTO and three senior engineers. Our recruiter has been in contact with two of them. They\'re willing to join if we match their equity packages (estimated $2M e',
      'Polaris Robotics submitted a partnership proposal that includes access to our Sentinel fraud detection algorithms. The proposal also requests employee secondments of Kevin Park and Jennifer Liu for 18',
      'Compliance incident report: An analyst on the Project Nighthawk deal team (Alex Petrov) was overheard discussing the Zephyron/Crestview merger terms on a personal phone call in the elevator. A complia',
      'The creditor committee for Vexilis Retail Group has rejected the 363 sale proposal from Hargrove Capital at $220M. The secured lenders led by Nordvale Bank want a credit bid at $180M to take control. The com',
    ],
  },
  {
    category: 'competitive_intel',
    label: 'Competitive Intelligence',
    centroid: null,
    threshold: 0.55,
    scoreBoost: 20,
    seeds: [
      'Our channel partner strategy targets 30% of enterprise revenue through partners by 2026. Current partnerships: Vexilis Advisory (3 joint deals worth $8.2M), Luminos Consulting (1 deal, $2.1M, stuck in procurement), an',
      'I\'m debugging a memory leak in the Falcon search indexer. The heap grows from 4GB to 16GB over 6 hours in production. Our custom inverted index implementation seems to be holding references to deleted',
      'Our internal SDK, DevForge, uses a custom serialization format that\'s 40% faster than Protocol Buffers for our specific workload. I need to add support for nested message types. Here\'s the current sch',
      'We need to decide on our observability strategy. The current Watchfire Analytics contract is $2.1M/year and up for renewal. We\'re evaluating: 1) Renewing Watchfire Analytics at a negotiated $1.7M, 2) Migrating to Grafana Clo',
      'Customer churn analysis for Q1: 14 customers churned ($4.8M ARR lost). Key churned accounts: DataStream Inc ($890K, moved to NovaSoft citing price), TechFlow Systems ($670K, moved to CloudPeak citing ',
      'We\'re planning a major pricing change effective July 1, 2026. Current pricing: $29/month (Starter), $79/month (Pro), $199/month (Enterprise). New pricing: $19/month (Starter), $99/month (Pro), $299/mo',
      'I need to optimize the query planner in our custom graph database engine, CodexDB. The current implementation does nested loop joins which is O(n*m) for cross-partition queries. We handle about 1.2 bi',
      'The proof of concept for Vertex Cloud\'s real-time analytics module showed our platform can process 4.2M events per second with sub-100ms query latency. However, when we tested with Horizon Financial\'s',
      'The enterprise platform encryption architecture has a fundamental flaw: customer data encryption keys are derived from a single master key using HKDF, but the derivation uses only the tenant ID as inp',
      'Our board is asking about the AI strategy. We\'re planning to invest $4M in building a proprietary LLM fine-tuning pipeline. The first use case is automating our underwriting decisions, which currently',
      'Here\'s the proprietary recommendation algorithm we\'ve been developing for 2 years. It\'s our core competitive advantage: def calculate_affinity_score(user, item): temporal_decay = exp(-0.023 * days_sin',
      'We\'re finalizing the PRD for Project Athena, our AI-powered code generation feature launching in Q3 2026. The feature is built on a custom fine-tuned model based on CodeLlama, trained on 500M code sam',
      'Our competitive moat analysis for the board: 1) Proprietary query engine (18 months ahead of NovaSoft, patent pending), 2) Multi-tenant isolation technology (unique in market, $4.2M R&D investment), 3',
      'The source code for our proprietary query optimizer, which gives us a 3x performance advantage over NovaSoft, was accidentally pushed to a public GitHub repository. The repo was public for 11 days bef',
      'Our custom load balancer\'s consistent hashing implementation has a flaw that causes 15% of traffic to route to a single node during member changes. Here\'s the proprietary rebalancing algorithm that we',
      'We\'re evaluating vendor contracts for renewal: Watchfire Analytics ($890K/year, 20% increase proposed), AlertForge ($210K/year, flat renewal), and Crystalvault Data ($1.4M/year, negotiating down to $1.1M). Our leverage wi',
      'Our data team built a custom feature store called FeatureForge that processes 2.3TB of feature data daily. The latency for online serving is 12ms p99 which is competitive with Tecton and Feast. We\'re ',
      'Our competitive analysis shows that Vertex Cloud\'s API response time (p95: 180ms) significantly outperforms NovaSoft (p95: 340ms) but trails behind CloudPeak (p95: 95ms). CloudPeak achieves this throu',
      'Our client\'s former CTO just joined their main competitor, Nexus Technologies, and we believe she took proprietary source code for the recommendation algorithm. The code is worth approximately $15M in',
      'The usage data for our Developer Platform shows that only 18% of API consumers use the v3 endpoints. We need to deprecate v1 which still handles 34% of traffic but is unmaintained. The migration will ',
      'I\'m working on the ML pipeline for Project Orion. Our training data includes 240M customer interaction records. The current model accuracy is 89.3% and we need to hit 94% for production readiness.',
      'Polaris Robotics submitted a partnership proposal that includes access to our Sentinel fraud detection algorithms. The proposal also requests employee secondments of Kevin Park and Jennifer Liu for 18',
      'The API key for our production OpenAI integration is sk-proj-abc123XYZ789def456GHI012jkl345MNO678. We\'re spending approximately $89K/month on GPT-4 API calls. The key has access to fine-tuned models c',
      'The Vanguard System deployment is using a proprietary compression algorithm our team developed. Can you help me document the architecture for internal knowledge sharing?',
      'The competitive loss analysis for Q4 reveals our win rate dropped from 45% to 31%. Detailed breakdown: Lost to NovaSoft 8 times ($14.2M total pipeline, primary reason: price), Lost to CloudPeak 5 time',
      'The caching layer in Project Zenith uses a custom LRU eviction policy with a bloom filter for negative lookups. We\'re seeing a 12% false positive rate which is causing unnecessary database queries. Ho',
      'The IP assignment audit found that 3 key engineers who built our core platform signed incorrect IP assignment agreements. Their employment contracts used the California template (which limits IP assig',
      'Our VaR model uses a 99th percentile confidence interval with a 10-day holding period. We assume equity-credit correlation of 0.65 and use a Monte Carlo simulation with 50,000 paths. The current portf',
      'URGENT: Derek O\'Connor\'s company laptop was stolen from his car last night. The laptop contained unencrypted files with 12,000 customer records including names, addresses, and credit card numbers. We ',
      'The intellectual property audit for Project Titan revealed that 30% of the codebase uses open-source libraries with GPL licenses, which conflicts with our commercial licensing model. The estimated cos',
      'The board approved a new pricing model effective Q3: usage-based pricing replacing per-seat licensing. Modeling shows 34% of current customers will see price increases (average +22%), while 66% will s',
      'Our patent application US2025/0234567 for the \'Adaptive Multi-Tenant Resource Allocation System\' is under review. The key innovation is our predictive resource scheduling algorithm that reduces cloud ',
      'Our proprietary machine learning model for fraud detection, codenamed Sentinel, uses a novel ensemble architecture that combines transformer networks with graph neural networks. NovaTech Solutions tri',
      'Here\'s the complete source code for our proprietary data compression algorithm that achieves 3.2x better compression than gzip for our specific data format. It\'s patent-pending (application #US2024/01',
      'We\'ve discovered that our competitor CloudPeak is using our patented multi-tenant isolation technology (US Patent 10,567,890). Our legal team at Wilson Sonsini (partner: Jennifer Walsh) has prepared a',
      'We\'re considering acquiring a small ML startup to accelerate our NLP capabilities. Our current NLP team of 4 engineers has been unable to match competitor accuracy levels. What technical due diligence',
      'Competitive intelligence from our source at NovaSoft (former employee who joined us last month): NovaSoft\'s platform has a fundamental scalability limitation - their architecture can\'t support more th',
      'Our recommendation engine uses a two-tower neural network architecture with a 128-dim embedding space. User features include purchase history, browse patterns, and demographic segments. The model is t',
      'The multi-cloud migration strategy for TransGlobal Logistics involves moving their Oraculum Systems workloads to PostgreSQL on our platform. Their current Oraculum Systems license costs $3.2M/year with Exadata hardware s',
      'M&A confidential: We\'re in advanced talks to acquire Prism Analytics for $28M. Their technology would give us a competitive edge in real-time data processing. Due diligence findings: they have $3.2M A',
      'Leveraged loan market color: CLO formation is down 22% YTD and warehouse lines are getting pulled. Our pipeline has $4.8B of committed leveraged loans that may be difficult to syndicate in this enviro',
      'I\'m building a custom query language for our analytics platform, called AQL (Analytics Query Language). It needs to support window functions and approximate aggregations using HyperLogLog. What parser',
      'The infrastructure cost model for our multi-tenant platform: - Per-tenant AWS cost: $2,340/month (RDS: $890, EKS: $670, S3: $340, misc: $440) - We charge enterprise tenants: $12,000/month minimum - Gr',
      'Our proprietary real-time bidding algorithm processes 2.4M bid requests per second. Here\'s the core logic that determines our bid price and has generated $67M in revenue this year: def calculate_bid(r',
      'I\'m optimizing the search ranking algorithm for Project Eclipse. The current implementation uses BM25 combined with a learned-to-rank model. Our NDCG@10 is 0.67 and the target is 0.78. The index holds',
      'Our user research team completed interviews with 120 enterprise customers. Key findings: 78% want deeper API customization, 64% struggle with our reporting UI, 41% are considering switching to Datasmi',
      'I\'m implementing a custom consensus protocol for our distributed config service. It\'s based on Raft but with a modified leader election that prioritizes nodes with the freshest data. The service is ca',
      'Our pricing strategy for the new Enterprise Plus tier: base platform fee of $50K/month, per-seat cost of $200/month, data processing at $0.002/GB. Our cost basis is approximately 35% of these prices. ',
      'The annual pricing review comparison: Our Enterprise tier: $12K/month base + $200/seat + $0.002/GB NovaSoft Enterprise: $8K/month base + $150/seat + $0.003/GB CloudPeak Pro: $10K/month base + $180/sea',
      'We\'re redesigning the onboarding flow for Project Vanguard. Current conversion from signup to activation is 23% and the target is 40%. The A/B test with the simplified 3-step flow showed a 31% activat',
    ],
  },
  {
    category: 'corporate_strategy',
    label: 'Corporate Strategy',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 20,
    seeds: [
      'We\'re seeing activist pressure build across the consumer staples sector. Several names are trading below intrinsic value with weak boards. How should we be positioning our defense advisory capabilitie',
      'I need to create a staffing plan for Project Titan Phase 2. We\'ll need to hire 15 engineers and 3 product managers over the next two quarters.',
      'I need to brief my manager on the competitive analysis we did for Zenith Program. The main competitor launched a similar feature last week.',
      'The RFP from Sterling Financial requires us to demonstrate our multi-region failover capabilities. Our current failover time is 8 minutes which doesn\'t meet their 2-minute RTO requirement. We\'re plann',
      'Trident Activist Fund has accumulated a 7.2% stake in Constellation Brands through swap agreements and is planning to file a 13D next week. They want three board seats and are pushing for a separation',
      'Project Cobalt pitch book update: Add the following comps to the semiconductor page. Non-public data points from our analysts: Stellarion Semiconductor\'s Q1 design wins are tracking 30% above internal plan. Helion Microdevices\' dat',
      'The competitive win report against NovaSoft at Federal Reserve Bank: We won the $6.2M contract by demonstrating our FedRAMP High authorization (NovaSoft only has Moderate). Key decision-makers: CIO Wi',
      'Vanguard Therapeutics has received an unsolicited approach from BioNexus Corp at $65 per share. The board is considering a white knight defense and wants us to approach Provence Pharma Services and Kelvin Life Sciences. Kee',
      'Venture Equity Partners is launching a tender offer for 51% of Magellan Corp at $44 per share, representing a 28% premium. They plan to follow with a short-form merger at the same price. The 14D-9 nee',
      'The enterprise deal pipeline with government agencies: 1) Department of Veterans Affairs - $14.2M, 5-year IDIQ, waiting on ATO, champion is Deputy CIO Sandra Martinez, 2) Department of Education - $6.',
      'We\'re designing the architecture for Project Nebula, our next-generation platform. Key technical decisions: 1) Moving from REST to gRPC for internal services, 2) Adopting Rust for performance-critical',
      'We\'re launching the Echo Platform internally next month. I need to draft a communication plan for the rollout across all three offices.',
      'Our sales pipeline for Q2 includes: Novalith Manufacturing ($2.3M TCV, 70% probability), ClearView Analytics ($1.8M TCV, 40% probability), and Federal Systems Group ($4.1M TCV, 25% probability). We need t',
      'Our internal developer platform, Forge, has an NPS score of 32 among our 450 engineers. The main complaints are: 15-minute average build times, flaky integration tests (23% failure rate), and poor doc',
      'Our channel partner strategy targets 30% of enterprise revenue through partners by 2026. Current partnerships: Vexilis Advisory (3 joint deals worth $8.2M), Luminos Consulting (1 deal, $2.1M, stuck in procurement), an',
      'The M&A scenario planning: if NovaSoft acquires us (rumored $400M offer through Whitfield Securities banker Patricia Lee), our enterprise customers would be migrated to NovaSoft\'s platform within 18 months.',
      'The competitive deal sheet for the Global Dynamics RFP ($12.4M TCV): Our pricing is $3.8M/year, NovaSoft bid $3.1M/year, CloudPeak bid $2.9M/year. Our differentiators: SOC 2 + FedRAMP (NovaSoft lacks ',
      'The board wants to understand the implications of a rights plan adoption. How do we advise them on pill trigger thresholds and flip-in provisions in the current regulatory environment?',
      'Board presentation draft - Confidential: FY2025 projections show $67M ARR (42% YoY growth), path to profitability in Q4 2026, and $23M in remaining runway. Key risks: 1) Zephyron Financial ($10.9M, 16',
      'Project Neptune board memo: Summarizing the three final bids received for OceanView Resorts. Bid A from Grandview Hospitality: $4.2B all-cash, no financing condition, 45-day close. Bid B from Crestview Hotels: $4.5B, 80% ca',
      'The win/loss analysis for Q4 shows: 12 deals won (avg TCV $1.8M), 8 deals lost (avg TCV $2.3M). Primary loss reasons: 1) Price (4 deals lost to NovaSoft), 2) Missing features (2 deals - no FedRAMP), 3',
      'The intellectual property audit for Project Titan revealed that 30% of the codebase uses open-source libraries with GPL licenses, which conflicts with our commercial licensing model. The estimated cos',
      'The Series C pitch deck financials: GMV processed: $89B annually, Take rate: 0.53%, Net revenue: $47.3M, Gross margin: 72%, Operating margin: -18% (burning $8.5M/year), Cash position: $31M (18 months ',
      'The partner deal registration for Luminos Consulting\'s Federal Health IT practice: they\'re bringing us into the VA Electronic Health Record modernization program. Estimated deal size: $18.4M over 7 years. Key ',
      'We\'re preparing the Q2 product strategy document for the board. The document outlines our feature roadmap including: (1) a new AI-powered code search capability (internal codename: Project Aurora), (2',
      'Trident Capital\'s activist campaign against Oceanview Corp is escalating. They now own 9.1% and have nominated four independent directors for the proxy fight. Their public letter demands $2B in share ',
      'I\'m preparing for the annual strategic planning offsite. Can you help me draft talking points about our market position relative to Quantex Systems?',
      'The quarterly investor update includes: 1) Net revenue retention: 112% (down from 128% last quarter), 2) New logo acquisition: 12 customers ($8.4M new ARR), 3) Expansion revenue: $3.2M from 34 existin',
      'We\'re planning to discontinue the legacy Polaris product line by Q4. Help me draft a customer migration timeline and communication plan.',
      'Project Falcon defense strategy: The hostile bidder (Hargrove Capital) has launched a tender offer at $56/share for all outstanding shares of Hayward Industries. Our client\'s board has adopted a poiso',
      'Confidential M&A impact analysis: If the Prism Analytics acquisition closes ($28M), we can cross-sell to their 23 enterprise customers. Immediate upsell opportunities: Aerolon Industries ($2.1M potential), Lockhe',
      'The open-source strategy review: we\'re planning to open-source the Vertex Query Engine (VQE) in Q3 to compete with DuckDB and Polars. The proprietary extensions (enterprise security, multi-tenant isol',
      'Can you help me write a summary of the new product features for Nexus that we plan to announce at the industry conference in June?',
      'Our Vertex Cloud platform roadmap includes adding FedRAMP High authorization by Q3 and SOC 2 Type II by Q4. The compliance engineering team is 6 people and they\'re already behind on the ISO 27001 cert',
      'The developer experience survey for our internal platform Forge shows adoption dropped from 89% to 71% after the v3 migration. Top complaints: breaking changes in the API gateway SDK, 40% longer build',
      'We\'re planning our next-generation mobile app (codename: Helios). The app is being rebuilt from scratch (React Native to native iOS + Android). Key features: offline-first sync, real-time collaboratio',
      'Our technical debt score for the Quantum platform is 7.2 out of 10 according to SonarQube. The main contributors are: 45% test coverage on the billing module, 230 known security hotspots, and 1,400 co',
      'We\'re finalizing the PRD for Project Athena, our AI-powered code generation feature launching in Q3 2026. The feature is built on a custom fine-tuned model based on CodeLlama, trained on 500M code sam',
      'The technology radar for H2 shows we\'re adopting: 1) eBPF for observability (replacing Watchfire Analytics agents, saving $340K/year), 2) WASM for edge computing in Project Horizon, 3) CRDTs for conflict-free dat',
      'I need to prepare a presentation about Project Titan\'s progress for the quarterly business review. Can you help me structure the key milestones?',
      'IPO readiness assessment for Luminos AI: The company needs to restate Q2 and Q3 revenue due to ASC 606 recognition issues—approximately $18M of revenue was pulled forward. This pushes the TTM revenue ',
      'The client wants to terminate their CEO for cause but the employment agreement requires a board vote and 30-day cure period. The CEO doesn\'t know yet. Draft a termination timeline and board resolution',
      'Our board voted yesterday to terminate the CEO effective immediately. The press release goes out tomorrow morning. The interim CEO is the current CFO, Maria Rodriguez. Draft talking points for the all',
      'Our team is working on the Catalyst Initiative which involves migrating our legacy billing system. What are the typical risks with this type of migration?',
      'The Quantum Leap initiative is behind schedule by three sprints. I need to prepare an escalation summary for the program steering committee.',
      'We\'re evaluating whether to move Project Helix from our Austin office to the Bangalore team. What factors should I consider in the transition plan?',
      'Our proprietary machine learning model for fraud detection, codenamed Sentinel, uses a novel ensemble architecture that combines transformer networks with graph neural networks. NovaTech Solutions tri',
      'We\'re planning our Q3 roadmap and engineering leadership is debating whether to invest in a major refactoring of our monolithic authentication service. The service currently handles 450M auth requests',
      'The target\'s management projections for Project Diamond look aggressive. Revenue CAGR of 25% over five years vs. 12% industry average. EBITDA margins expanding 800bps with no clear driver. Our indepen',
      'Our competitive analysis shows that Vertex Cloud\'s API response time (p95: 180ms) significantly outperforms NovaSoft (p95: 340ms) but trails behind CloudPeak (p95: 95ms). CloudPeak achieves this throu',
    ],
  },
  {
    category: 'healthcare_phi',
    label: 'Healthcare / Clinical',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 25,
    seeds: [
      'Pediatric oncology case: Patient Emily Morrison, age 8, MRN 3301289, was diagnosed with acute lymphoblastic leukemia (ALL) at Riverside Children\'s Hospital. She\'s starting the COG AALL0232 protocol. H',
      'The financial analysis shows that our orthopedics service line generated $8.2M in margin last quarter, while cardiology dropped to $1.1M due to payer mix changes. We\'re considering recruiting two addi',
      'The opioid stewardship committee reports that 12% of patients discharged from our ED received prescriptions for more than a 7-day supply of opioids, exceeding state law limits. The committee recommend',
      'Reproductive genetics consultation: Couple Jonathan and Emily Richardson are seeking preimplantation genetic testing for their IVF cycle at Pacific Fertility Center. Jonathan, MRN 6621201, carries a b',
      'Patient John Martinez, DOB 03/15/1978, MRN 4521889, was admitted on 02/14/2026 with acute chest pain. ECG showed ST elevation in leads II, III, and aVF. Troponin was 4.2 ng/mL. Diagnosed with inferior',
      'Workers\' compensation evaluation for patient Carlos Mendez, MRN 9921201, a 45-year-old construction worker who fell from scaffolding at a Horizon Properties LLC jobsite. He sustained L4-L5 disc hernia',
      'Addiction medicine consultation for patient Kevin O\'Brien, MRN 8829147, who presented to the ED after a heroin overdose reversed with naloxone. He reports using heroin IV daily for 3 years and also us',
      'Disability evaluation for patient Sandra Hoffman, MRN 8821478, age 50, a registered nurse at Memorial General Hospital applying for long-term disability benefits. Diagnoses: fibromyalgia, chronic fati',
      'Psychiatric emergency consultation: Patient Nicole Armstrong, age 34, MRN 7712089, a schoolteacher at Lincoln Elementary, was brought by police after making threats to harm her students. She has a dia',
      'Neonatal abstinence syndrome: Baby Boy Gonzalez, MRN 2201999, born at Memorial General Hospital on March 1st at 34 weeks gestation. Mother Maria Gonzalez (MRN 9921047) tested positive for opioids and ',
      'Project Lighthouse final bid analysis: Nordhaven Capital at $38/share (all cash), Alivera Capital at $36/share with a $2/share CVR tied to FDA approval, and the management-led MBO at $34/share with ',
      'Business associate breach notification: Our EHR vendor, HealthTech Systems, informed us that a ransomware attack compromised the PHI of approximately 180,000 patients at Memorial General Hospital. The',
      'The peer review committee identified a trend of increasing complication rates in our bariatric surgery program. The leak rate is 3.2% versus a national benchmark of 1.5%. We\'re reviewing whether surge',
      'Room 412B, patient James Wilson, DOB 05/14/1962, is reporting severe chest pain radiating to his left arm. His vitals: BP 180/110, HR 120, SpO2 92%. He\'s on a heparin drip at 1200 units/hour. His wife',
      'Stark Law self-disclosure: Riverside Medical Center has been referring patients to Advanced Imaging Associates, a radiology group in which the hospital CEO, Dr. Anthony Russo, holds a 25% ownership in',
      'I need to investigate a billing fraud pattern involving Dr. Harold Foster at Evergreen Family Medicine. He\'s been billing for 45-minute psychotherapy sessions (CPT 90834) for patients who only receive',
      'We\'re seeing a cluster of post-surgical complications in our cardiac surgery program. The 30-day readmission rate has spiked to 22% versus a national average of 12%. No individual patient data, but th',
      'For Project Sapphire, run the LBO sensitivity table at entry multiples of 9x-11x, leverage of 5.0x-6.5x, and exit multiples of 10x-13x. Atlas Partners needs this by tomorrow for their IC memo. The tar',
      'Project Horizon PIPE update: The $350M PIPE for Vanguard Fintech\'s SPAC merger with Nexus Payments is anchored by Harbridge Capital ($150M) and Pinecrest Advisors ($100M). Remaining $100M from family offices. ',
      'Transplant evaluation for patient Alexander Petrov, MRN 7729045, age 52, who needs a liver transplant due to alcoholic cirrhosis. He completed the required 6-month sobriety period but his urine drug s',
      'Redwood Capital is preparing a hostile bid for Sequoia Materials at $28 per share, contingent on financing from Sterling Meridian Group and Pemberton Securities. The breakup fee demand is 4% and they want to launch a tend',
      'Our coding audit found that 18% of sampled charts had upcoding patterns in the emergency department, primarily involving level 4 and 5 E/M codes. The potential overpayment is estimated at $1.2M annual',
      'Controlled substance inventory discrepancy: The monthly Schedule II reconciliation at Memorial General Hospital\'s main pharmacy shows a shortage of 2,400 units of fentanyl 100mcg/2mL vials. The discre',
      'Project Atlas: The LBO model for Vexilis Software shows sponsor returns of 2.8x MOIC and 24% IRR at the base case entry multiple of 12.5x LTM EBITDA. Debt package is 5.5x first lien / 1.5x second lie',
      'Our access audit logs show that 45 users accessed more than 100 patient records in a single shift last month. While some may be legitimate (e.g., billing staff), this pattern warrants investigation fo',
      'For Project Cornerstone, Pinnacle Growth Partners is offering $2.1B with a $175M rollover from the founder. The breakup fee is set at 3.5% of enterprise value. Draft the fee letter reflecting a 1.5% a',
      'Our nurse satisfaction survey results show that 40% of nursing staff on the medical-surgical floor are considering leaving within the next 12 months. The primary drivers are staffing ratios and mandat',
      'Patient Sarah Martinez, MRN 4829103, was admitted to Memorial General Hospital with acute myocardial infarction. She has a history of type 2 diabetes, hypertension, and depression. Current medications',
      'We received 3 patient complaints about a physician who allegedly discussed patient cases in the hospital cafeteria within earshot of visitors. The complaints are anonymous and don\'t name specific pati',
      'Genetic test results for patient Diana Kowalski, MRN 8821045, age 42: Whole exome sequencing revealed a pathogenic variant in the HTT gene consistent with Huntington\'s disease. Estimated age of onset ',
      'The quarterly quality dashboard shows that our surgical site infection rate increased to 4.2% from 2.8% last quarter. We need to present this to the board along with the root cause analysis from the i',
      'End-of-life care conference notes for patient William Thornton, MRN 8821290, age 82, Room 501, at Lakeside Hospice. His wife Margaret Thornton and three adult children attended. The oncologist, Dr. Pa',
      'False Claims Act investigation: The DOJ Civil Division has issued a civil investigative demand to Lakeside Community Health Center regarding its Medicare billing practices for behavioral health servic',
      'The pressure injury prevalence survey conducted last month showed an overall rate of 3.8%, with Stage 2 injuries being most common. The wound care team recommends implementing a standardized skin asse',
      'Prescription verification for patient Elizabeth Chen, DOB 11/22/1985, MRN 5501892: Dr. James Park prescribed OxyContin 80mg TID, which is an unusually high dose for a patient with no prior opioid hist',
      'The management presentation for Project Ironclad is scheduled for next Tuesday. The CEO of Westfield Logistics will present the 5-year plan showing revenue growth from $420M to $780M and EBITDA margin',
      'Emergency department diversion crisis: Memorial General Hospital\'s ED has been on diversion for 18 of the last 24 hours due to psychiatric boarding. Currently 14 psychiatric patients are boarding in t',
      '42 CFR Part 2 violation: The substance abuse treatment records for patient Victor Petrov, MRN 5512890, were disclosed to his employer, Atlas Construction LLC, by office manager Linda Morrison at Meado',
      'The workforce training dashboard shows that 15% of clinical staff have not completed their annual HIPAA training. The departments with the lowest compliance rates are Emergency Medicine (28% non-compl',
      'The DSMB has recommended unblinding and early termination of the XR-4421 clinical trial (NCT-2025-44821) due to a safety signal. Four participants experienced hepatotoxicity requiring hospitalization.',
      'Data safety monitoring board emergency meeting minutes for the CRISPR sickle cell gene therapy trial (IND #BB-IND-29401): Participant Sandra Hoffman (Subject RES-2025-0089) developed T-cell lymphoma 8',
      'Dr. Williams has had 3 malpractice claims in the last 2 years, all involving post-surgical infections in orthopedic cases. The credentialing committee is meeting next week to discuss restricting his s',
      'Opioid overdose investigation: Patient Christopher Blake, MRN 9921478, received a fatal dose of morphine at Lakeside Community Health Center on March 3rd. The electronic medication administration reco',
      'The annual HIPAA risk assessment identified 14 medium-risk vulnerabilities in our EHR system, including unencrypted backup tapes and shared login credentials in three departments. Draft the remediatio',
      'Patient Robert Johnson, age 45, MRN 6641028, presented to the psychiatry clinic with suicidal ideation and a plan involving firearms. He reports hearing voices commanding him to harm himself. He has a',
      'The compliance hotline received an anonymous tip that billing manager Sharon Wells at Riverside Medical Center has been creating duplicate claims for surgical procedures and directing the overpayments',
      'Monarch Holdings\' Chapter 11 plan includes a rights offering backstopped by Ravencrest Capital at $150M, giving them 40% of the reorganized equity. Existing equity holders are getting wiped out. The confi',
      'RAC audit results for Memorial General Hospital: The Recovery Audit Contractor has identified $3.8M in overpayments across 245 claims. The largest category is short-stay inpatient admissions that shou',
      'Medicare fraud referral: Dr. Patricia Alvarez at Sunrise Pain Management Clinic has been billing for epidural steroid injections (CPT 62322) that were never performed. Chart review of 50 sampled claim',
      'Project Phoenix is moving to Phase 2. Ridgemont Partners submitted an IOI at $42 per share, implying a 35% premium to the undisturbed price. We need to update the board book with their proposed financ',
    ],
  },
  {
    category: 'government_classified',
    label: 'Government / Classified',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 30,
    seeds: [
      'We\'re investigating a potential front-running pattern in trader ID 4821\'s activity. Between March and June, his personal account purchased shares in 12 of the 15 companies our fund later took position',
      'CFIUS has flagged the Project Orion cross-border acquisition. SinoTech Holdings (Beijing) is acquiring Quantum Defense Systems (Arlington, VA) for $3.4B. The Committee has identified national security',
      'Project Titan regulatory update: The HSR waiting period expired without a second request, so antitrust is clear. However, EU Commission DG Comp has opened a Phase II investigation into the Zephyron/Cr',
      'Project Zenith: Cross-border acquisition of Müller Maschinenbau GmbH (Munich) by Precision Industrial Corp (Chicago). EUR 1.2B purchase price. German regulatory approval (Bundeskartellamt) obtained. C',
      'Project Silverstone consortium update: The minority stake sale in Novalith Racing Technologies has attracted a consortium bid from RedBird Capital and the Saudi Public Investment Fund. Combined offer: $1.',
      'Private placement memo for Project Summit: Ascend Logistics is raising $200M of unsecured notes in a Rule 144A private placement. 7-year maturity, expected coupon 8.25-8.75%. Use of proceeds: refinanc',
      'Regulatory risk escalation for Project Zenith: The FTC has issued a Civil Investigative Demand (CID) related to the Veriden Pharmaceuticals/Zenith Biotech transaction. They\'re investigating potential anticompetitive e',
      'Chapter 15 recognition petition: Orion Energy\'s UK subsidiary (Orion Energy Holdings Ltd) has filed for administration in England under the Insolvency Act 1986. We need to file a Chapter 15 petition i',
    ],
  },
  {
    category: 'board_communications',
    label: 'Board-Level Communications',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 25,
    seeds: [
      'The revenue recognition review for CloudNine Software Inc. revealed channel stuffing in Q4. VP of Sales Derek Thompson offered extended 180-day payment terms and guaranteed return rights to distributo',
      'We discovered that accounts payable clerk Maria Santos at Consolidated Pacific Industries has been creating fictitious vendors and routing payments to her personal bank account at Clearfield National, account',
      'For the current sell-side we\'re running, what are the best ways to position a company with declining revenue but expanding margins? The buyer universe is mostly strategics in adjacent verticals.',
      'The management presentation for Project Ironclad is scheduled for next Tuesday. The CEO of Westfield Logistics will present the 5-year plan showing revenue growth from $420M to $780M and EBITDA margin',
      'The surprise cash count at Heritage National Bank\'s downtown branch revealed a $450K shortage. Branch manager Carlos Mendez could not account for the discrepancy. Security camera footage shows him rem',
      'The internal investigation at Summit Ridge Partners confirmed that managing partner Andrew Lawson has been personally guaranteeing loans using fund assets as collateral without LP consent. He pledged ',
      'Our platform\'s source code is stored in GitHub with strict access controls. During code review on PR #47832, an engineer submitted code that included our company\'s proprietary encryption key format (c',
      'We need to report a potential FCPA violation. Our Brazil subsidiary at Granite Point Capital paid $2.5M in \'consulting fees\' to a firm called Rio Assessoria Ltda., which is owned by the nephew of the ',
      'The tax team discovered that Harmon Industries has been claiming R&D tax credits on projects that don\'t qualify under Section 41. Controller Lisa Park approved $8.2M in fraudulent credits over three t',
      'Compliance incident report: An analyst on the Project Nighthawk deal team (Alex Petrov) was overheard discussing the Zephyron/Crestview merger terms on a personal phone call in the elevator. A complia',
      'We\'re working on a deal where the target operates in a fragmented industry with lots of bolt-on potential. How should we frame the platform thesis in the CIM without revealing which subsector we\'re fo',
      'Quarterly gift and entertainment report flagged the following: PM Derek Walsh spent $12,500 on a private dinner and concert tickets for pension fund allocator Michael Stevens of Pacifica State Retirement. Separately, a',
      'Inventory fraud at Consolidated Pacific Industries: Plant manager Raymond Cooper at the Memphis facility has been inflating physical inventory counts by approximately $18M over two years. He created f',
      'Project Zenith is a carve-out of the diagnostics division from Altair Health Sciences. The division does $310M revenue with 28% EBITDA margins. We expect 12x-14x multiples given precedent diagnostics ',
      'The sample testing of expense reimbursements uncovered that approximately 7% of submissions in the executive travel category lacked proper supporting documentation. Total exposure is roughly $340K.',
      'The variance analysis for Q2 shows operating expenses came in 8% above budget, primarily driven by increased compliance costs. Help me prepare the management discussion points.',
      'The target\'s management projections for Project Diamond look aggressive. Revenue CAGR of 25% over five years vs. 12% industry average. EBITDA margins expanding 800bps with no clear driver. Our indepen',
      'Our testing of the loan origination process revealed that credit committee approvals were retroactively obtained for 12 loans totaling $28M. This represents a significant control deficiency.',
      'IPO readiness assessment for Luminos AI: The company needs to restate Q2 and Q3 revenue due to ASC 606 recognition issues—approximately $18M of revenue was pulled forward. This pushes the TTM revenue ',
      'The client wants to terminate their CEO for cause but the employment agreement requires a board vote and 30-day cure period. The CEO doesn\'t know yet. Draft a termination timeline and board resolution',
      'SOX 302/906 certification issue: CEO William Fletcher of Heritage National Bank is refusing to sign the quarterly certification because he\'s been informed by general counsel that the bank\'s allowance ',
      'The Project Mercury management presentation deck needs to include the synergy analysis. Acquirer expects $120M in cost synergies (60% headcount, 30% procurement, 10% facilities) achievable over 3 year',
      'Our board voted yesterday to terminate the CEO effective immediately. The press release goes out tomorrow morning. The interim CEO is the current CFO, Maria Rodriguez. Draft talking points for the all',
      'Project Diamond fairness opinion: Our DCF yields a range of $41-$49 per share using WACC of 8.5-9.5% and terminal growth of 2.0-2.5%. The precedent transaction analysis shows $44-$52, and the trading ',
      'Material finding: Heritage National Bank\'s CEO William Fletcher directed the treasury department to purchase $200M in mortgage-backed securities from a fund managed by his son-in-law, Christopher Blak',
      'During our walkthrough of the derivatives booking process, we identified that mark-to-market valuations for certain OTC contracts rely on stale pricing inputs. This affects approximately $50M notional',
      'The forensic audit of Stonebridge Financial Group uncovered that CFO David Harrington authorized the capitalization of $23M in operating expenses over FY2024 and FY2025, materially overstating EBITDA ',
      'The annual anti-corruption certification process revealed that managing director James O\'Connor at our London office failed to disclose payments of £180,000 to a UK government official\'s private consu',
      'During the audit of Silverline Bancorp, we discovered that branch manager Angela Morrison has been approving personal loans to her family members without proper disclosure. Her brother Thomas Morrison',
      'Our inventory obsolescence reserve methodology is under scrutiny from the external auditors. They believe we should increase the reserve by $4M based on aging analysis.',
      'Whistleblower complaint: Senior VP of Commercial Lending, Robert Chang at Pacific Coast Savings Bank, has been waiving appraisal requirements on commercial real estate loans over $5M for developer cli',
      'The forensic accounting team found that Novalith Manufacturing\'s CEO James Whitmore directed the creation of fictitious sales invoices to a shell company called Pacific Rim Distributors to inflate Q3 reve',
      'Related party transaction disclosure failure: Granite Point Capital\'s board member Richard Thornton failed to disclose that his wife, Elizabeth Thornton, owns a 40% interest in Cascade Consulting Grou',
      'What\'s the right way to adjust for non-recurring litigation costs in a normalized EBITDA calculation when the company has had three consecutive years of settlements? At what point does it become recur',
      'Lease accounting restatement: We discovered that Luminos Global Partners failed to capitalize 42 operating leases with a total present value of $95M under ASC 842. The error has persisted for three fisc',
      'DCF model assumptions for Project Ember: Revenue growth declining from 22% to terminal 3%. EBITDA margins expanding from 18% to 26% over the projection period. CapEx at 5% of revenue. Working capital ',
      'Project Neptune board memo: Summarizing the three final bids received for OceanView Resorts. Bid A from Grandview Hospitality: $4.2B all-cash, no financing condition, 45-day close. Bid B from Crestview Hotels: $4.5B, 80% ca',
      'Our operational risk loss database shows a 40% increase in cyber-related incidents this quarter. The aggregate loss amount is $1.2M. Draft the quarterly OpRisk report summary.',
      'The payroll department at Ridgemont Securities discovered that former HR director Sharon Wells created 8 ghost employees in the system over a 3-year period. The fictitious employees received direct de',
      'IT audit finding: The penetration test of Heritage National Bank\'s online banking platform revealed that customer account data, including SSNs, account numbers, and balances for approximately 340,000 ',
      'The external audit of Crosshaven Capital\'s financial statements revealed that the firm has been netting long and short derivative positions for balance sheet presentation purposes, reducing reported g',
      'The preliminary audit findings suggest that revenue recognition timing on three contract categories may need adjustment. The potential restatement impact is between $2M and $5M.',
      'I\'m building the CIM for Project Redwood. The target, Greenfield Organics, has shown 18% revenue CAGR over the last five years with EBITDA growing from $22M to $58M. The CEO, Michael Torres, will need',
      'I need to update the Project Aurora CIM. Crestview Equity Partners wants to see adjusted EBITDA excluding the $18M one-time facility consolidation charge. The target\'s run-rate EBITDA is $145M on $890',
      'Forensic investigation summary for Stonebridge Financial Group: Total identified fraud amounts to $89M over five years. CFO David Harrington orchestrated a scheme involving fictitious revenue ($45M), ',
      'Board-confidential: We need to restate Q1 and Q2 earnings. The securitization team at Granite Point Capital booked $340M in synthetic CDO profits using an internal model that significantly overvalued ',
      'The daily P&L reconciliation for the fixed income desk shows an unexplained $18M discrepancy. Head trader Benjamin Stark claims it\'s a timing difference in swap valuations, but the independent price v',
      'Emergency restatement memo: The accounting team at Silverline Bancorp discovered that SVP of Commercial Lending, Karen Walsh, has been booking loan interest income on $120M in non-performing commercia',
      'The intercompany reconciliation for Luminos Global Partners shows a $14M discrepancy between the US parent and the Bermuda reinsurance subsidiary. VP of Tax Planning Michael Brennan has been routing pre',
      'Project Falcon defense strategy: The hostile bidder (Hargrove Capital) has launched a tender offer at $56/share for all outstanding shares of Hayward Industries. Our client\'s board has adopted a poiso',
    ],
  },
  {
    category: 'customer_data',
    label: 'Customer / Client Data',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 20,
    seeds: [
      'We\'re advising a real estate developer on zoning challenges for a mixed-use project. What are the typical variance application strategies?',
      'We\'re evaluating vendor contracts for renewal: Watchfire Analytics ($890K/year, 20% increase proposed), AlertForge ($210K/year, flat renewal), and Crystalvault Data ($1.4M/year, negotiating down to $1.1M). Our leverage wi',
      'Our internal penetration testing tool discovered that the Redis instance at redis-sessions.prod.internal:6379 has no AUTH configured and is accessible from any pod in the Kubernetes cluster. It stores',
      'The customer success team\'s internal risk assessment: 34 enterprise accounts ($28.4M ARR) are classified as \'high churn risk.\' The top 5 at-risk accounts with their specific issues: 1) Zephyron Financ',
      'We need to assess whether our client\'s proposed employee monitoring program complies with state wiretapping and privacy laws.',
      'Helixtara Pharmaceuticals has agreed to enter a Corporate Integrity Agreement with HHS. Kellan Varek will serve as compliance monitor. Total financial terms: $280 million fine, $120 million in resti',
      'Orbivex Holdings\' CEO Fenwick Crane authorized a $5 million payment to a local government official in the Philippines to secure mining permits. This potentially violates the FCPA. Tessara Ling',
      'I need to draft an executive employment agreement with non-solicitation provisions for a client in the financial services industry.',
      'Private equity exit planning: Luminos Growth Partners is preparing to sell its 65% stake in Zephyron Health Solutions for an estimated $800M. The exit multiple of 14x EBITDA hasn\'t been disclosed to LPs',
      'Execute the following wash sale arrangement for client George Henderson, account HND-78901: Sell $5M in municipal bonds at a loss of $800K for tax harvesting purposes, then repurchase substantially id',
      'Customer Pinnacle Health\'s HIPAA breach notification: During routine monitoring, we discovered that their PHI data (4.2M patient records including diagnoses, medications, SSNs, and insurance IDs) was ',
      'Novalith Capital\'s forensic accountant found that Quartzite Mining Corp inflated EBITDA by $67 million through improper capitalization of exploration costs. This was not disclosed in the merger due diligence',
      'Confidential: Crestview Partners is planning to acquire Thornveil Energy before Q3 earnings. The deal is valued at approximately $890 million. Robert Chen from Crestview needs us to begin antitrust a',
      'Generate the quarterly performance report for the Westbrook Charitable Foundation, account WCF-78901. The portfolio returned -4.2% versus the benchmark -2.1%. The underperformance was driven by the ov',
      'Mr. Henderson\'s portfolio is currently allocated 60% equities, 30% fixed income, 10% alternatives. Total value is $4.2M. He wants to increase his exposure to emerging markets but his risk tolerance qu',
      'Luminos Financial Group\'s internal investigation found that three traders, including Corvin Hale, executed wash trades to inflate the price of synthetic CDOs. Total artificial volume was approximately ',
      'The annual customer health scorecard for our top 20 accounts: 1. Zephyron Financial - $10.9M ARR, Health: RED (usage -23%, champion departed) 2. TechVault Corp - $5.2M ARR, Health: GREEN (expanding to',
      'We\'re working on a leveraged recap where the existing private equity sponsor is taking cash out at a 4x multiple. Debt/EBITDA will rise from 2.8x to 4.1x post-transaction. The target company is a nich',
      'Here\'s the database migration script for our user PII vault: ALTER TABLE pii_vault ADD COLUMN tax_id VARCHAR(20); ALTER TABLE pii_vault ADD COLUMN passport_number VARCHAR(30); ALTER TABLE pii_vault AD',
      'The annual contract value analysis by vertical: Financial Services - $18.9M (40% of ARR, 23 customers), Healthcare - $8.4M (18%, 12 customers), Government - $7.2M (15%, 8 customers), Manufacturing - $',
      'Received a call from Vertex Corp\'s CEO. They want us to run a dual-track process—prepare for an IPO while simultaneously soliciting acquisition offers. Revenue is $420M growing 35% YoY. They want a mi',
      'M&A confidential: We\'re in advanced talks to acquire Prism Analytics for $28M. Their technology would give us a competitive edge in real-time data processing. Due diligence findings: they have $3.2M A',
      'Vanguard Realty\'s merger with Westlake Development is contingent on resolving the Diana Reeves litigation. Theron Ashford proposes offering Reeves $8 million and a mutual non-disparagement clause. The',
      'Aurelian Dynamics\' internal investigation revealed that Daxon Merriweather maintained a personal email account (r.fontaine.private@protonmail.com) to communicate with co-conspirators about the stock',
      'The QBR for Pinnacle Insurance revealed they\'re evaluating NovaSoft as an alternative. Their concerns: 1) Our price is 30% higher than NovaSoft\'s proposal, 2) Missing ITAR compliance certification, 3)',
      'Draft a clawback demand letter to former Vexilis Biotech CEO Lyria Wentworth for $4.8 million in performance-based compensation. The compensation was based on clinical trial milestones that we now kn',
      'Eastpoint Media is negotiating a consent order with the FTC regarding deceptive advertising practices. Grace Holloway proposes paying a $22 million fine and implementing a 10-year compliance monitorin',
      'Client wants to wire $2.3M to First National Bank of Switzerland, account IBAN CH93 0076 2011 6238 5295 7, beneficiary Hartwell Trust Ltd, reference: Q4 distribution. Process today.',
      'Elder financial exploitation alert: Account holder Dorothy Patterson, age 87, account PAT-22019, has been making unusual large withdrawals totaling $340K over the past month. Her grandson, Tyler Patte',
      'FINRA examination finding: Our review of the options trading activity for registered representative Amanda Liu, CRD# 6247891, revealed excessive trading in 14 customer accounts generating $890K in com',
      'Acme Corp\'s contract renewal is at risk. Their usage has dropped 34% quarter-over-quarter and their champion, VP of Engineering Lisa Chen, left the company last month. The replacement, Thomas Wright, ',
      'Covenant package for the $2.1B TLB financing Project Granite: Max net leverage 6.25x stepping down to 5.5x by Year 3. Interest coverage floor 2.0x. CapEx basket at $75M. Restricted payments basket 50%',
      'Prepare the Section 363 sale motion for Thornveil Energy\'s bankruptcy. Victoria Langley has identified Crestview Partners as the stalking horse bidder at $210 million. The credit committee is expecte',
      'Restructure the Davidson Family Office account DVF-10042: sell all municipal bond holdings ($7.8M), close the margin loan ($2.1M outstanding at 5.75%), and transfer the remaining equity portfolio ($12',
      'Work product: Analysis of potential RICO claims against Vexilis Biotech executives. Lyria Wentworth and Kellan Varek formed what appears to be an enterprise to defraud investors through systematic',
      'During the incident last night, we found that user data for approximately 47,000 accounts was accessible through an IDOR vulnerability in the /api/v2/users/{id}/profile endpoint. Affected users includ',
      'The zero-day vulnerability in our custom API gateway: a specially crafted HTTP/2 CONTINUATION frame can cause a heap buffer overflow that allows remote code execution. The vulnerability affects all 15',
      'NovaTech Inc IPO: Books are 8.2x oversubscribed at the midpoint of $28-$32. Northgate Investments wants 15% of the deal, Ridgemont Asset Management is in for 12%. We\'re recommending pricing at $34, above range. Greenshoe is 4.5M s',
      'Orbivex Holdings\' insurance broker confirmed that their environmental liability policy has a $100 million aggregate limit. With estimated remediation costs of $145 million and personal injury claim',
      'We represent a software company that\'s exploring an acquisition of a smaller SaaS platform. The target\'s ARR is $25M growing 35% annually. Our client\'s ARR is $185M growing 22%. We\'re trying to decide',
      'The quantitative strategies group at Blackwood Capital needs to implement the new pairs trading algorithm on client accounts. Start with the Henderson Retirement Trust (account BKW-44521) and the Silv',
      'Lisa Nakamura\'s witness statement in the Aurelian Dynamics whistleblower case confirms that CFO Daxon Merriweather directed the accounting team to reclassify $28 million in operating expenses as cap',
      'Crestview Partners and Thornveil Energy merger update: The HSR waiting period expires next Tuesday. Solara Quintero from FTC staff indicated informally that no second request is forthcoming. Deal closi',
      'Revenue breakdown by customer for Q4: Zephyron Financial $2.8M (renewal at risk), TechVault Corp $2.1M (expanding), Novalith Manufacturing $1.9M (stable), Sterling Insurance $1.7M (evaluating competitor),',
      'Elara Voss\'s privileged memo outlines Novalith Capital\'s plan to acquire a 15% stake in Quartzite Mining Corp through a series of shell companies to avoid triggering the 13D filing requirement. Total inve',
      'I\'m drafting an indemnification provision for a software licensing agreement. The client is a mid-size SaaS company. What carve-outs are standard?',
      'Our user research team completed interviews with 120 enterprise customers. Key findings: 78% want deeper API customization, 64% struggle with our reporting UI, 41% are considering switching to Datasmi',
      'A nonprofit client is restructuring its board governance. What fiduciary duty considerations apply to nonprofit directors?',
      'The production error tracking dashboard shows that user Daniel Kim (daniel.kim@bigcorp.com, enterprise account #E-4521) has been hitting a null pointer exception in the billing module 340 times in the',
      'Revenue clawback calculation: Three hedge fund clients of Vexilis Asset Management are exercising their most-favored-nation clauses following the fee reduction offered to anchor investor CalSTRS. The',
    ],
  },
  {
    category: 'tech_security',
    label: 'Technology / Security',
    centroid: null,
    threshold: 0.5,
    scoreBoost: 25,
    seeds: [
      'Our penetration testing results came back from our third-party security firm and there are 3 critical vulnerabilities, 7 high-severity issues, and 12 medium-severity findings. The critical issues are:',
      'The software supply chain audit revealed: 1) 12 npm packages in our production dependency tree are maintained by a single developer who hasn\'t responded to security reports in 6 months, 2) Our Docker ',
      'The security architecture review for our FedRAMP boundary identified that 3 third-party services (Nexaphone, MailForge, and TrackPulse) process data within our authorization boundary but aren\'t listed in our',
      'Our SIEM detected a potential data exfiltration. An internal service account (svc-analytics@corp.internal) made 12,000 API calls to the user data endpoint between 2AM and 4AM. The account pulled recor',
      'Here\'s the complete source code for our proprietary data compression algorithm that achieves 3.2x better compression than gzip for our specific data format. It\'s patent-pending (application #US2024/01',
      'Here\'s our security audit findings that I need to address before the SOC 2 Type II audit next month: 1) SSH keys for prod servers haven\'t been rotated in 14 months, 2) 23 former employees still have a',
      'The Firebase admin SDK private key for our production mobile backend is: { "type": "service_account", "project_id": "ourapp-prod-2024", "private_key_id": "a1b2c3d4e5f6", "private_key": "-----BEGIN RSA',
      'The post-migration analysis for our Cassandra-to-ScyllaDB move shows: read latency improved from 4.5ms to 1.2ms p99, write throughput increased 3.4x, but we discovered a data consistency issue during ',
      'Our Project Titan service is experiencing 99th percentile latency spikes of 2.3 seconds during peak hours. The internal load balancer at lb-titan-prod.internal is routing unevenly. Can you help me ana',
      'The infrastructure access audit shows: 1) 23 terminated employees still have active SSH keys on production servers, 2) 7 contractors have root access to customer database servers, 3) The shared servic',
      'I discovered that our user authentication table stores passwords using MD5 hashing without salt. The table has 6.2M accounts. Here\'s a sample row: user_id: 89012, email: jennifer.walsh@example.com, pa',
      'The FedRAMP continuous monitoring report shows 14 POA&Ms (Plan of Action and Milestones) that are overdue by more than 90 days. Critical findings include: 1) Vulnerability scanning only covers 67% of ',
      'Our code review found a backdoor in the authentication module committed by a contractor 8 months ago. The code checks if the password matches the string \'contractor_master_2024\' and bypasses all authe',
      'The CloudFormation template for our production VPC includes: VPN gateway credentials (PSK: \'vpn-prod-psk-2024-s3cur3!\'), NAT gateway elastic IPs (52.14.89.203, 52.14.89.204), database subnet CIDR rang',
      'The JWT signing secret for our production auth service is: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9_SIGNING_SECRET_v3_prod. It\'s hardcoded in the auth-service config at /etc/auth-service/jwt.conf. I need ',
      'The dependency scan found that our internal npm registry at npm.corp.internal hosts 47 packages with known CVEs. 12 of these are in the critical path for our authentication service. What\'s a good prio',
      'Our annual security audit by Vexilis Advisory identified 2 critical findings, 5 high-severity findings, and 12 medium-severity findings. Critical: (1) Unsecured S3 buckets with 2.3TB of unencrypted PII, (2) O',
      'We\'re building a new feature called Smart Compose for our enterprise email product. It will use GPT-4 integration to suggest email completions. The feature is targeting Q2 launch but hasn\'t been annou',
      'The post-mortem for the February 28 outage: A misconfigured Terraform apply deleted the production RDS cluster for 23 enterprise customers. Data loss window: 4 hours (last backup was 4 hours before de',
      'We discovered that our MongoDB instance at mongo-prod.internal:27017 has been running without authentication for the past 6 months after a misconfigured deployment. It contains the entire customer dat',
      'Our bug bounty program received a report about a privilege escalation in our admin API. By modifying the role field in the JWT payload from \'user\' to \'admin\', anyone can access /api/admin/users/export',
      'The customer data export tool has a bug that includes deleted customer data in exports. When customer Novalith Financial requested a GDPR data export, the response included data for 3 other customers: Ste',
      'Our production incident last week exposed a security gap in our code review process. A junior engineer merged code that contained a hardcoded AWS API key in the DynamoDB connection string. The key was',
      'Customer Pinnacle Health\'s HIPAA breach notification: During routine monitoring, we discovered that their PHI data (4.2M patient records including diagnoses, medications, SSNs, and insurance IDs) was ',
      'The code review of our billing system revealed a rounding error that has been overcharging 12% of enterprise customers by an average of $340/month for the past 8 months. Total overcharged amount: $892',
      'The API rate limiting architecture for our enterprise tier needs redesign. Currently, we use a token bucket algorithm with a shared Redis counter. At 890K requests per second, the Redis instance becom',
      'The multi-tenant isolation breach in our Kubernetes platform: Customer A (Novalith Financial) can read environment variables from Customer B (Sterling Healthcare) pods due to a misconfigured network polic',
      'We need to present our tech debt assessment to the VP. The analysis shows 34% of our backend codebase has no test coverage, the authentication module hasn\'t been refactored since 2019, and our deploym',
      'The auto-scaling group for our API tier currently runs between 24 and 120 c5.4xlarge instances. During last month\'s flash sale, we hit the 120 instance limit and had to manually increase it. The ASG i',
      'We discovered a SQL injection vulnerability in the /api/v2/users endpoint yesterday. It\'s been present since the v3.2 release in September. We have evidence that it was exploited. We haven\'t patched i',
      'Our internal secrets vault at vault.prod.internal:8200 was misconfigured with a root token that never expires: hvs.CAESIG1234567890abcdefghijklmnop. The token has access to all secret engines includin',
      'Our platform reliability has been at 99.91% uptime this quarter, missing our 99.95% SLA. The main contributors are 3 incidents related to the payment service and 2 from the notification system. I need',
      'The customer implementation for Global Defense Corp requires handling ITAR-controlled data. The technical requirements include: 1) All data processed in US-only data centers by US persons only, 2) Enc',
      'I need to debug the OAuth callback handler. Here\'s the production config: client_id: \'prod-webapp-oauth-client\' client_secret: \'dGhpcyBpcyBhIHByb2Qgc2VjcmV0IGtleQ==\' redirect_uri: \'https://app.ourcomp',
      'Here\'s our users table schema that I need help optimizing: CREATE TABLE users ( id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL, ssn_encrypted BYTEA, credit_card_token VARCHAR(64), full_name VARCHA',
      'The security assessment of customer Zephyron Financial\'s deployment revealed: their admin panel uses our default credentials (admin/VertexCloud2024!), their API gateway has no rate limiting, and their',
      'Our Kubernetes cluster kube-prod-east-1 is running at 78% CPU utilization across 340 nodes. We need to plan capacity for Black Friday traffic which historically 4x\'s our load. What scaling strategy do',
      'Project Quantum\'s architecture review revealed that our current database design won\'t scale beyond 50M users. We\'re at 34M now and growing 8% month-over-month. The re-architecture would cost approxima',
      'The Kubernetes cluster credentials for all production environments: Cluster: vertex-prod-us-east-1 API Server: https://k8s-api.prod-east.internal:6443 CA Cert: base64(LS0tLS1CRUdJTi...) Admin Token: e',
      'We found a SQL injection vulnerability in the user search endpoint. The query is constructed as: \`SELECT * FROM users WHERE name LIKE \'%${userInput}%\' AND account_status = \'active\'\`. This endpoint is ',
      'The Watchfire Analytics agent on our production hosts is reporting memory usage of 94% on 8 out of 24 app servers (app-prod-01 through app-prod-24). The services running on these hosts are the user-facing API and',
      'Confidential board presentation data: Our annual recurring revenue is $47.3M with a burn rate of $3.2M/month. We have 18 months of runway. Key customer concentration risk: Zephyron Financial (23% of r',
      'The source code for our proprietary query optimizer, which gives us a 3x performance advantage over NovaSoft, was accidentally pushed to a public GitHub repository. The repo was public for 11 days bef',
      'We need to design our event streaming architecture for Project Polaris. Currently evaluating whether to use Kafka with exactly-once semantics or Pulsar with its built-in tiered storage. Our event volu',
      'The data residency mapping for our EU enterprise customers shows non-compliant data flows: 1) Frankfurter Volksbank customer data (890K German citizens) replicated to us-east-1 for analytics, 2) NHS D',
      'The penetration test report for our enterprise platform identified 4 critical findings: 1) Cross-tenant data access via GraphQL query depth exploitation, 2) SSRF in the webhook configuration allowing ',
      'The technology due diligence report for our Series C: 1) Technical debt estimated at 34% of codebase, remediation cost $8.4M, 2) Single points of failure in 7 critical services, 3) No automated disast',
      'Our CI pipeline on Jenkins takes 47 minutes for the main branch. The bottleneck is the integration test suite which spins up 12 Docker containers. The build cluster is at build-farm.corp.internal with',
      'Our Vestapay API key got exposed in a client-side bundle: sk_live_51HG3j2KZvKYlo2C0tL8xjM9w2b4vN6rT. It\'s been live for about 3 hours. What\'s the fastest way to rotate this and check for unauthorized ch',
      'Our Terraform state files for the production environment are stored in S3 bucket tf-state-prod-2024. We need to migrate to a new state management approach because the current setup doesn\'t support pro',
    ],
  },
];

// ── Cosine Similarity ────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ── Semantic Classifier ──────────────────────────────────────────────────────

export class SemanticTopicClassifier {
  private clusters: TopicCluster[];
  private adapter: EmbeddingAdapter | null = null;
  private initialized = false;

  constructor(clusters: TopicCluster[] = TOPIC_CLUSTERS) {
    this.clusters = clusters.map(c => ({ ...c }));
  }

  /**
   * Initialize with an embedding adapter.
   * Computes centroids from seed sentences if not already set.
   */
  async init(adapter: EmbeddingAdapter): Promise<void> {
    this.adapter = adapter;

    if (!adapter.isReady()) {
      console.warn('[Iron Gate] Embedding model not ready — semantic classifier disabled');
      return;
    }

    // Compute centroids from seeds for clusters that don't have one
    for (const cluster of this.clusters) {
      if (cluster.centroid) continue;

      try {
        const embeddings = await adapter.embedBatch(cluster.seeds);
        cluster.centroid = averageVectors(embeddings);
      } catch (err) {
        console.warn(`[Iron Gate] Failed to compute centroid for ${cluster.category}:`, err);
      }
    }

    this.initialized = true;
    console.log(`[Iron Gate] Semantic classifier initialized with ${this.clusters.filter(c => c.centroid).length} topic clusters (${this.clusters.reduce((s, c) => s + c.seeds.length, 0)} seeds)`);
  }

  /**
   * Check if the classifier is ready to use.
   */
  isReady(): boolean {
    return this.initialized && this.adapter !== null && this.adapter.isReady();
  }

  /**
   * Classify a text against all topic clusters.
   * Returns matched topics and their score contributions.
   */
  async classify(text: string): Promise<SemanticClassification> {
    if (!this.isReady() || !this.adapter) {
      return { matches: [], totalBoost: 0, topCategory: null };
    }

    // Truncate long texts — embeddings work best on shorter passages
    const truncated = text.length > 1000 ? text.substring(0, 1000) : text;

    let embedding: number[];
    try {
      embedding = await this.adapter.embed(truncated);
    } catch {
      return { matches: [], totalBoost: 0, topCategory: null };
    }

    const matches: SemanticMatch[] = [];

    for (const cluster of this.clusters) {
      if (!cluster.centroid) continue;

      const similarity = cosineSimilarity(embedding, cluster.centroid);

      if (similarity >= cluster.threshold) {
        matches.push({
          category: cluster.category,
          label: cluster.label,
          similarity: Math.round(similarity * 100) / 100,
          scoreBoost: cluster.scoreBoost,
        });
      }
    }

    // Sort by similarity descending
    matches.sort((a, b) => b.similarity - a.similarity);

    // Total boost is the sum of all matched boosts, capped at 50
    const totalBoost = Math.min(50, matches.reduce((sum, m) => sum + m.scoreBoost, 0));

    return {
      matches,
      totalBoost,
      topCategory: matches.length > 0 ? matches[0].category : null,
    };
  }

  /**
   * Load pre-computed centroids from a JSON asset.
   * Use this to skip recomputing on every startup.
   */
  loadCentroids(centroids: Record<string, number[]>): void {
    for (const cluster of this.clusters) {
      if (centroids[cluster.category]) {
        cluster.centroid = centroids[cluster.category];
      }
    }
  }

  /**
   * Export computed centroids for caching.
   */
  exportCentroids(): Record<string, number[]> {
    const result: Record<string, number[]> = {};
    for (const cluster of this.clusters) {
      if (cluster.centroid) {
        result[cluster.category] = cluster.centroid;
      }
    }
    return result;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += vec[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    avg[i] /= vectors.length;
  }

  // L2 normalize the centroid
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += avg[i] * avg[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      avg[i] /= norm;
    }
  }

  return avg;
}

// ── Singleton ────────────────────────────────────────────────────────────────

let instance: SemanticTopicClassifier | null = null;

export function getSemanticClassifier(): SemanticTopicClassifier {
  if (!instance) {
    instance = new SemanticTopicClassifier();
  }
  return instance;
}
