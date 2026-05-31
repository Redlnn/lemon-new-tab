# Lemon New Tab Privacy Policy

> Last updated: 2026-05-04

This Privacy Policy applies to the browser extension **Lemon New Tab** and its related public source code repository.

This extension is designed to run in a **local-first** manner. Some online features are **enabled by default or available by default**, including search suggestions, Jinrishici content, and third-party favicon lookup. Other online features usually require your own action or configuration, such as online wallpapers, some third-party content sources, or browser account sync. Regardless of whether such features are enabled, the extension does not proactively send your data to the developer's own servers. Based on the current source code, the developer **does not operate a dedicated backend that collects extension users' personal data**.

Contact email: <lemon@redlnn.top>

## 1. Who We Are

The developer of this extension is the maintainer of this project repository. For the extension's own functionality, data processing is intentionally kept as much as possible within your browser and device.

For the design, provision, and operation of the extension features, the developer acts as a **data controller** or equivalent personal information handler to the extent the developer actually determines the purposes and means of processing under applicable law.

Browser stores, browser sync infrastructure, third-party APIs, and any online resources you configure yourself may each act as **independent controllers/processors** for their own data practices. Those activities are not directly controlled by the extension developer.

## 2. What This Policy Covers

This Policy covers four categories of processing:

1. **Local extension processing**: data stored in browser local storage, session storage, or IndexedDB.
2. **Browser sync**: data handled by the browser vendor's sync infrastructure when you enable account-based sync.
3. **Third-party service requests**: requests sent directly from your browser to external services when you enable online features.
4. **App store distribution**: data that browser stores may process for installation, updates, diagnostics, or analytics.

## 3. What the Extension Itself May Process

### 3.1 Data stored locally on your device

The extension store the following data locally on your device:

- extension settings and UI preferences, such as theme, layout, search engine configuration, and background settings;
- Quick Links, bookmark display settings, and local state related to frequently visited sites;
- tab title, page URL, hostname, and favicon-related cache processed locally to display Quick Links, frequently visited sites, or related site cards;
- search history, if that local feature is enabled;
- local wallpapers, video wallpapers, cached Bing wallpapers, and related metadata;
- sync metadata such as device name, device identifier, sync timestamps, and sync version numbers;
- custom search engine lists, synced settings snapshots, and synced Quick Links data.

This data is generally stored in your browser environment and is controlled by you or your browser. It is not automatically transmitted to the developer.

### 3.2 Data accessed through browser permissions

According to the extension manifest, the extension may access:

- **bookmarks**: to display, search, or open your browser bookmarks;
- **topSites / browsing activity related capabilities**: to show frequently visited sites;
- **storage**: to save settings, cache, and sync state;
- **tabs / activeTab / scripting** (depending on browser): to interact with tabs, the new tab page, and related pages;
- **optional host permissions**: when you enable features that need access to website resources, such as fetching favicons or loading online media from arbitrary sites.

These permissions are used to provide local functionality. For example, the extension may read **page titles, page URLs / hostnames, and favicon information** from tabs you visit or currently open in order to display Quick Links, frequently visited sites, or related site cards. Such information is generally processed locally in your browser and does not mean the developer receives that content.

## 4. What We Do Not Do

Except as otherwise described in this Policy, the extension developer does **not** proactively collect, sell, rent, or upload the following information to developer-operated servers:

- your identity information, contact details, or payment information;
- the contents of your bookmarks, browsing history, or search terms;
- the contents of your local images, videos, or files;
- copies of page titles, page URLs, site hostnames, or favicon data from your tabs, except where your browser sends the relevant request directly to a third-party service;
- your extension settings, Quick Links, wallpaper files, or search history.

If you enable browser sync or third-party online features, relevant data may instead be received and processed by the **browser vendor or the third-party service provider**.

## 5. Data That Browser Stores or Browser Vendors May Collect

This extension is distributed through third-party browser stores. Browser stores, browser vendors, or their infrastructure may independently collect or process:

- account information, installation status, and version information;
- device information, browser type, and operating system information;
- crash reports, download statistics, diagnostics, and usage analytics;
- payment or subscription information, if platform monetization is ever involved.

These activities are not directly controlled by the extension developer. Please review the relevant platform privacy materials:

- Microsoft: <https://www.microsoft.com/privacy/privacystatement>
- Google: <https://policies.google.com/privacy>
- Mozilla: <https://www.mozilla.org/privacy/>
- Chrome Web Store: <https://chromewebstore.google.com/>
- Microsoft Edge Add-ons: <https://microsoftedge.microsoft.com/addons>
- Firefox Add-ons: <https://addons.mozilla.org/>

## 6. Third-Party Services and Potential Risks

For online features that are enabled by default, available by default, or manually enabled by you, your browser communicates directly with the following third-party services. In that case, those services can typically receive at least your **IP address, request time, User-Agent, request parameters, and possibly referrer/context information** depending on browser behavior and service configuration. They may also keep logs, apply rate limits, perform fraud prevention, or transfer data across borders under their own rules.

### 6.1 Jinrishici API

- Purpose: fetch Chinese poetry content;
- Endpoint used in the code: `https://v2.jinrishici.com/one.json`
- Default status: **enabled by default / available by default**;
- Risk note: the Jinrishici service may receive and process source IP and other network metadata. Its API responses may also include a token associated with the requester. The extension developer does not control its logging, routing, retention, or downstream handling.

### 6.2 Hitokoto API

- Purpose: fetch quote / sentence content;
- Endpoint used in the code: `https://v1.hitokoto.cn`
- Risk note: the Hitokoto service may process request metadata for traffic control, statistics, abuse prevention, or operations. Such processing is independently determined by that service.

### 6.3 Search Suggestion APIs

- Bing suggestions: `https://api.bing.com/`
- Baidu suggestions: `https://suggestion.baidu.com/`
- Google suggestions: `https://suggestqueries.google.com/`

Purpose: return suggested search queries while you type.

Risk notes:

- related search suggestion functionality is enabled by default or available by default;
- the search text you type is sent directly to the corresponding provider;
- those providers may log search keywords, IP addresses, browser/device data, and request logs;
- using Google, Bing, or other global services may involve **cross-border data transfers**;
- **Bing-specific note**: in mainland China network environments, `www.bing.com` or related Bing services may be redirected to or associated with `cn.bing.com` or other China-related service endpoints depending on regional policies, network conditions, or provider configuration. As a result, the actual processing location, applicable law, and service operator may vary.

### 6.4 Bing Wallpaper API

- Purpose: fetch daily wallpaper metadata and images;
- Endpoint used in the code: `https://www.bing.com/HPImageArchive.aspx?...`

Risk notes:

- your browser sends requests directly to Bing for wallpaper metadata and image files;
- those requests may expose your IP address, request time, and browser/device characteristics;
- depending on region, Bing routing, edge nodes, redirect behavior, and processing location may differ and may involve processing inside or outside mainland China.

### 6.5 Third-Party Favicon Services

- Purpose: obtain site icons when the extension does not directly read them from the target website;
- Endpoints used in the code: `https://favicon.so/` and `https://favicon.im/`
- Default status: **enabled by default / available by default**;

Risk notes:

- the request includes the hostname of the website whose icon is being fetched;
- the favicon provider may therefore learn which site icon was requested and may log your IP address, time, and target hostname;
- server location, retention, and operational practices may change over time and are outside the developer's control.

### 6.6 User-Configured Online Wallpaper / Media URLs

- Purpose: allow you to use any image, video, or API endpoint that you choose;
- Risk note: once you configure an online resource URL, your browser sends requests directly to that site. The developer cannot review or control that site's privacy practices, security, legality, logging behavior, cross-border transfers, or downstream uses. Only use providers you trust.

## 7. Purposes of Processing

The extension, browser vendor, or third parties may process data for purposes such as:

- providing new tab page functionality;
- storing your local preferences and cache;
- syncing settings across devices through your browser account;
- providing search suggestions, wallpapers, poetry, quotes, and site icons;
- maintaining service stability, rate limiting, abuse prevention, security, and troubleshooting.

## 8. Lawful Bases for Processing

Where the GDPR or similar laws apply, the developer relies, within the scope actually controlled by the developer, on the following lawful bases.

### 8.1 Necessity for providing the requested service

Processing necessary for the extension's core local functionality, such as saving settings, reading local extension state, showing bookmarks or frequently visited sites, and rendering the page layout or background you selected, is treated as necessary to provide the functionality you requested.

### 8.2 Consent

For online features that cause your browser to send requests to third parties, especially the **enabled-by-default or available-by-default** search suggestions, Jinrishici content, and third-party favicon lookup, the extension treats those requests as based on your **consent**. You may withdraw that consent by disabling the relevant feature, switching to a non-network alternative, blocking the relevant domains, clearing related cache, or uninstalling the extension.

Requests triggered by online wallpaper URLs, media URLs, third-party API endpoints, or other custom online resources that you configure are also treated as based on your consent.

### 8.3 Legitimate interests

To the extent applicable to the developer or a third-party provider, logging, rate limiting, security protection, troubleshooting, abuse detection, integrity protection, and compatibility improvements may be based on legitimate interests. However, this lawful basis **does not replace consent** where consent is required for default third-party network requests.

### 8.4 Legal obligation

Processing may also occur where necessary to comply with legal obligations, lawful requests, regulatory requirements, or mandatory disclosures.

## 9. Data Retention

### 9.1 Local data

Data stored locally by the extension is generally retained until one of the following happens:

- you manually delete it through extension settings, browser settings, or developer tools;
- you uninstall the extension;
- you clear browser site data, extension storage, or local cache;
- the browser removes it under its own storage or sync policies.

### 9.2 Browser sync data

If you enable browser sync, retention is determined by the browser vendor. The developer cannot independently set or remove the vendor's cloud copies. You can usually manage this through your browser account, sync settings, or sync data reset tools.

### 9.3 Third-party logs and caches

For Jinrishici, Hitokoto, Bing, Google, Baidu, favicon services, and any custom online resources you use, retention periods for logs, caches, and access records are determined by those providers. The extension developer usually does not know the exact retention period and cannot delete those records on their behalf.

## 10. Cookies and Similar Technologies

The extension itself does not set cookies on developer-operated servers and does not use tracking pixels on developer-controlled websites to identify you.

However, **third-party services and browser platforms** may use cookies, browser cache, Local Storage, IndexedDB, ETags, log identifiers, device identifiers, or similar technologies in scenarios such as:

- search suggestion services identifying sessions, routing regions, rate limiting, or abuse prevention;
- Bing, Google, Baidu, or other platforms returning region-specific content based on network environment or prior state;
- Jinrishici or other third-party APIs returning or recording tokens, cache keys, or request identifiers;
- browser stores or browser vendors supporting login, installation, analytics, updates, or security verification.

Those cookies or similar technologies are controlled by the relevant third party, not directly by the extension developer. You can usually manage them through browser settings, content blocking rules, site permissions, private browsing, sign-out actions, or by disabling the relevant feature.

## 11. Cross-Border Data Transfers

The extension developer does not currently operate a dedicated backend that centrally receives your extension data. However, when you enable third-party online features, your requests may be sent outside your country/region, or may be processed inside one jurisdiction and then further transferred by the provider.

The following scenarios may therefore involve cross-border transfer risks:

- using Google search suggestions;
- using Bing global services or related CDNs / edge nodes;
- using favicon services hosted outside your region;
- using online wallpapers, media, or API endpoints hosted abroad;
- using browser account sync infrastructure.

Different jurisdictions provide different levels of personal data protection. Transfer mechanisms that may be used by relevant providers can include, without limitation, Standard Contractual Clauses (SCCs), intra-group transfer rules, statutory certification or assessment mechanisms, data localization arrangements, regional traffic routing, or direct cross-border requests initiated on the basis of your consent. Because the developer does not control those third-party infrastructures, the developer cannot guarantee that any particular mechanism applies to every service or every region.

For third-party request features that are enabled by default or available by default, you may stop future cross-border transfers by disabling the relevant feature, blocking the relevant domains, using a non-network alternative, or uninstalling the extension.

## 12. Your Rights

Depending on applicable law, including the GDPR, China's PIPL, and the CCPA/CPRA, you may have rights such as:

- the right to know;
- the right to access;
- the right to correct;
- the right to delete;
- the right to restrict processing;
- the right to object;
- the right to data portability, where applicable and technically feasible;
- the right to withdraw consent for consent-based processing;
- the right to complain to a supervisory authority or regulator.

### 12.1 How to exercise your rights

For processing actually within the developer's control, you may exercise your rights by:

1. sending a request to **lemon@redlnn.top**;
2. using the subject line **Privacy Request**;
3. stating the type of request involved, such as access, correction, deletion, withdrawal of consent, restriction, objection, or complaint, and identifying the relevant browser, extension version, and feature module if known;
4. providing only the minimum information needed to locate the issue, and not sending unnecessary sensitive information;
5. contacting the relevant browser vendor or third-party provider directly where the requested data is controlled by them rather than by the developer.

The developer will make reasonable efforts to respond within the period required by applicable law. If the developer cannot verify the request, cannot access the relevant data, or the data is entirely controlled by a third party, the developer will explain that limitation.

### 12.2 For this extension specifically

For this extension specifically:

- because the developer generally **does not hold a server-side copy of your extension content**, practical control over most data remains with you, your browser vendor, or the relevant third-party service;
- you can exercise much of your control by uninstalling the extension, clearing browser extension storage, disabling online features, deleting local wallpapers and search history, or turning off browser sync;
- if you have questions about matters within the developer's controllable scope, contact <lemon@redlnn.top>.

## 13. Children

This extension is not specifically directed to children. If you are considered a minor under the law of your jurisdiction, use online features only under guidance from a parent or guardian.

If you believe a third-party service has processed a child's personal information without proper authorization, please contact that third-party provider directly. You may also contact the developer for matters within the developer's actual control.

## 14. Compliance Statement

This Privacy Policy is intended to describe, in a clear and understandable manner, the boundaries of data collection, storage, transfer, and processing relevant to this extension in light of **the GDPR, the Personal Information Protection Law of the People's Republic of China (PIPL), and U.S. state privacy laws such as the California CCPA/CPRA**.

Because this extension relies on browser platforms and third-party services, the exact legal obligations, processing locations, and retention periods may vary depending on your location, the browser vendor's policies, the third-party provider's infrastructure, and future product changes.

References in this Policy to concepts such as "consent", "legitimate interests", and "data controller / processor" should be interpreted within the limits of applicable law and actual factual control. If mandatory law requires a different result, the applicable law will prevail.

## 15. Recommended Third-Party Policies

You should also review the following third-party privacy materials:

- Microsoft Privacy Statement: <https://www.microsoft.com/privacy/privacystatement>
- Google Privacy Policy: <https://policies.google.com/privacy>
- Mozilla Privacy Policy: <https://www.mozilla.org/privacy/>
- Baidu Privacy Platform: <https://privacy.baidu.com/policy>
- Jinrishici documentation: <https://www.jinrishici.com/doc/>
- Hitokoto Developer Center: <https://developer.hitokoto.cn/>

If a third-party service does not publish a complete privacy policy, you should assume that enabling that service may still expose basic network metadata to that provider and evaluate the related risks yourself.

## 16. Updates to This Policy

If the extension's features, permissions, dependencies, or legal requirements change, the developer may update this Privacy Policy. Updated versions may be published in the project repository or release channels.
