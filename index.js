import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import pa11y from 'pa11y';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import dns from 'dns';
import net from 'net';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate a unique ID for the file name
function generateUniqueId() {
    return Math.random().toString(36).substring(2, 15);
}

async function runLighthouse(url) {
    try {
        const chrome = await launch({ chromeFlags: ['--headless'] });
        
        // Define device emulations (mobile and desktop)
        const deviceProfiles = {
            mobile: { formFactor: 'mobile', screenEmulation: { disabled: false } },
            desktop: { formFactor: 'desktop', screenEmulation: { disabled: true } }
        };

        // Iterate through both device profiles (mobile and desktop)
        const results = {};
        for (const [deviceType, config] of Object.entries(deviceProfiles)) {
            const options = { logLevel: 'info', output: 'json', port: chrome.port, ...config };
            const runnerResult = await lighthouse(url, options);
            const lighthouseReport = runnerResult.lhr;

            // Core Web Vitals metrics: LCP, FID, CLS
            const coreWebVitals = {
                lcp: lighthouseReport.audits['largest-contentful-paint'].displayValue,
                fid: lighthouseReport.audits['max-potential-fid'].displayValue,
                cls: lighthouseReport.audits['cumulative-layout-shift'].displayValue
            };

            results[deviceType] = {
                seoScore: lighthouseReport.categories.seo.score * 100,
                accessibilityScore: lighthouseReport.categories.accessibility.score * 100,
                performanceScore: lighthouseReport.categories.performance.score * 100,
                bestPracticesScore: lighthouseReport.categories['best-practices'].score * 100,
                metrics: {
                    firstContentfulPaint: lighthouseReport.audits['first-contentful-paint'].displayValue,
                    largestContentfulPaint: lighthouseReport.audits['largest-contentful-paint'].displayValue,
                    timeToInteractive: lighthouseReport.audits['interactive'].displayValue,
                    cumulativeLayoutShift: lighthouseReport.audits['cumulative-layout-shift'].displayValue
                },
                coreWebVitals,
                audits: lighthouseReport.audits
            };
        }

        await chrome.kill();
        return results;
    } catch (error) {
        console.error('Error running Lighthouse:', error);
        return null;
    }
}

async function runPa11y(url) {
    try {
        const result = await pa11y(url);
        return result;
    } catch (error) {
        console.error('Error running Pa11y:', error);
        return null;
    }
}

async function checkHttpsRedirect(url) {
    return new Promise((resolve) => {
        const parsedUrl = new URL(url);
        const httpUrl = `http://${parsedUrl.hostname}`;
        http.get(httpUrl, (res) => {
            resolve(res.headers.location === url);
        }).on('error', (error) => {
            console.error('Error checking HTTPS redirect:', error);
            resolve(false);
        });
    });
}

async function checkOpenPorts(hostname) {
    const commonPorts = [80, 443, 21, 22, 25, 3306, 3389];
    const results = await Promise.all(commonPorts.map(port => 
        new Promise(resolve => {
            const socket = new net.Socket();
            socket.setTimeout(1000);
            socket.on('connect', () => {
                socket.destroy();
                resolve(`Port ${port} is open`);
            });
            socket.on('timeout', () => {
                socket.destroy();
                resolve(`Port ${port} is closed or filtered`);
            });
            socket.on('error', () => {
                resolve(`Port ${port} is closed or filtered`);
            });
            socket.connect(port, hostname);
        })
    ));
    return results;
}

async function checkDNSRecords(hostname) {
    return new Promise((resolve) => {
        dns.resolveTxt(hostname, (err, records) => {
            if (err || !Array.isArray(records)) {
                resolve([]);  // Return an empty array if no records are found or if there is an error
            } else {
                resolve(records);
            }
        });
    });
}

async function checkSecurity(url) {
    const { hostname } = new URL(url);
    const httpsRedirect = await checkHttpsRedirect(url);
    const openPorts = await checkOpenPorts(hostname);
    const dnsRecords = await checkDNSRecords(hostname);

    return {
        httpsRedirect,
        openPorts,
        dnsRecords
    };
}

// Function to save report in "Reports" folder
async function saveReportToFile(report, url) {
    const uniqueId = generateUniqueId();
    const reportsDir = path.join(__dirname, 'Reports');

    // Ensure the Reports directory exists
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir);
    }

    const fileName = `${url.replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueId}.md`;
    const filePath = path.join(reportsDir, fileName);

    try {
        const reportContent = await formatReport(report, url);
        fs.writeFileSync(filePath, reportContent, 'utf8');
        console.log(`Report saved to ${filePath}`);
    } catch (error) {
        console.error('Error saving report to file:', error);
    }
}

async function formatReport(report, url) {
    const recommendations = [];

    const mobileMetrics = report.lighthouse.mobile.metrics;
    const desktopMetrics = report.lighthouse.desktop.metrics;

    // Add performance recommendations based on device
    if (report.lighthouse.mobile.performanceScore < 90) {
        recommendations.push('Mobile: Optimize images, reduce JavaScript, and improve time to interactive.');
    }
    if (report.lighthouse.desktop.performanceScore < 90) {
        recommendations.push('Desktop: Optimize images, reduce JavaScript, and improve time to interactive.');
    }

    // Including Core Web Vitals in the report
    const mobileCoreWebVitals = report.lighthouse.mobile.coreWebVitals;
    const desktopCoreWebVitals = report.lighthouse.desktop.coreWebVitals;

    const simplifiedAudits = Object.values(report.lighthouse.mobile.audits)
        .filter(audit => audit.score < 0.9)
        .map(audit => ({
            title: audit.title,
            description: audit.description,
            score: audit.score * 100
        }));

    let reportContent = 
`# Website Audit Report for: ${url}

## Summary
- **Mobile SEO Score**: ${report.lighthouse.mobile.seoScore}
- **Mobile Accessibility Score**: ${report.lighthouse.mobile.accessibilityScore}
- **Mobile Performance Score**: ${report.lighthouse.mobile.performanceScore}
- **Mobile Best Practices Score**: ${report.lighthouse.mobile.bestPracticesScore}
- **Desktop SEO Score**: ${report.lighthouse.desktop.seoScore}
- **Desktop Accessibility Score**: ${report.lighthouse.desktop.accessibilityScore}
- **Desktop Performance Score**: ${report.lighthouse.desktop.performanceScore}
- **Desktop Best Practices Score**: ${report.lighthouse.desktop.bestPracticesScore}

## Detailed Performance Metrics
### Mobile:
- **First Contentful Paint (FCP)**: ${mobileMetrics.firstContentfulPaint}
- **Largest Contentful Paint (LCP)**: ${mobileMetrics.largestContentfulPaint}
- **Time to Interactive (TTI)**: ${mobileMetrics.timeToInteractive}
- **Cumulative Layout Shift (CLS)**: ${mobileMetrics.cumulativeLayoutShift}

#### Core Web Vitals (Mobile)
- **Largest Contentful Paint (LCP)**: ${mobileCoreWebVitals.lcp}
- **First Input Delay (FID)**: ${mobileCoreWebVitals.fid}
- **Cumulative Layout Shift (CLS)**: ${mobileCoreWebVitals.cls}

### Desktop:
- **First Contentful Paint (FCP)**: ${desktopMetrics.firstContentfulPaint}
- **Largest Contentful Paint (LCP)**: ${desktopMetrics.largestContentfulPaint}
- **Time to Interactive (TTI)**: ${desktopMetrics.timeToInteractive}
- **Cumulative Layout Shift (CLS)**: ${desktopMetrics.cumulativeLayoutShift}

#### Core Web Vitals (Desktop)
- **Largest Contentful Paint (LCP)**: ${desktopCoreWebVitals.lcp}
- **First Input Delay (FID)**: ${desktopCoreWebVitals.fid}
- **Cumulative Layout Shift (CLS)**: ${desktopCoreWebVitals.cls}

## Recommendations:
${recommendations.length ? recommendations.map(r => `- ${r}`).join('\n') : 'No major issues found.'}

## Detailed Report

### Lighthouse Audit Details
${simplifiedAudits.map(audit => `- **${audit.title}**: ${audit.description} (Score: ${audit.score})`).join('\n')}

### Pa11y Accessibility Issues
${report.pa11y.length ? report.pa11y.map(issue => `- ${issue.message} (${issue.code})`).join('\n') : 'No accessibility issues found.'}

### Security Checks
- **HTTPS Redirect**: ${report.security.httpsRedirect ? 'Passed' : 'Failed'}
- **Open Ports**: 
${report.security.openPorts.map(portStatus => `  - ${portStatus}`).join('\n')}
- **DNS TXT Records**: ${report.security.dnsRecords.length ? report.security.dnsRecords.map(record => record.join(' ')).join('\n') : 'No DNS TXT records found'}
`;


    // Generate OpenAI summary
    try {
        const TextAnalysisPrompt = `Summarize the following website audit report:\n\n${reportContent}`;
        const TextAnalysisResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "user",
                    content: TextAnalysisPrompt,
                },
            ],
        });

        const summary = TextAnalysisResponse.choices[0].message.content;
        return `${reportContent}\n\n## Summary by OpenAI\n${summary}`;
    } catch (error) {
        console.error('OpenAI API error:', error);
        return reportContent;  // Return the report content without summary if there is an error
    }
}

function formatUrl(inputUrl) {
    console.log('Initial URL:', inputUrl);
    inputUrl = inputUrl.trim();
    if (!/^https?:\/\//i.test(inputUrl)) {
        inputUrl = `https://${inputUrl}`;
    }
    console.log('URL after adding https://:', inputUrl);

    try {
        const url = new URL(inputUrl);
        if (url.pathname === '' || url.pathname === '/') {
            url.pathname = '/';
        }
        console.log('Formatted URL:', url.href);
        return url.href;
    } catch (err) {
        console.error('Invalid URL:', inputUrl);
        process.exit(1);
    }
}

async function auditWebsite(inputUrl) {
    try {
        const formattedUrl = formatUrl(inputUrl);
        console.log(`Auditing website: ${formattedUrl}`);

        const lighthouseResults = await runLighthouse(formattedUrl);
        const pa11yResults = await runPa11y(formattedUrl);
        const securityResults = await checkSecurity(formattedUrl);

        const finalReport = {
            url: formattedUrl,
            lighthouse: lighthouseResults,
            pa11y: pa11yResults ? pa11yResults.issues : [],
            security: securityResults
        };

        await saveReportToFile(finalReport, formattedUrl);
        console.log('Audit complete. Check the generated markdown file for results.');
        process.exit(0);
    } catch (error) {
        console.error('Error auditing website:', error);
        process.exit(1);
    }
}

const url = process.argv[2];
if (!url) {
    console.error('Please provide a URL to audit.');
    process.exit(1);
}
auditWebsite(url);