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
        const options = { logLevel: 'info', output: 'json', port: chrome.port };
        const runnerResult = await lighthouse(url, options);
        const lighthouseReport = runnerResult.lhr;

        const detailedReport = {
            seoScore: lighthouseReport.categories.seo.score * 100,
            accessibilityScore: lighthouseReport.categories.accessibility.score * 100,
            performanceScore: lighthouseReport.categories.performance.score * 100,
            bestPracticesScore: lighthouseReport.categories['best-practices'].score * 100,
            audits: lighthouseReport.audits
        };

        await chrome.kill();
        return detailedReport;
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
            if (err) {
                resolve('No TXT records found or error in lookup');
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

// Function to save report in "Reports" folder and append an OpenAI summary
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
        const reportContent = formatReport(report, url);

        // Save the report first
        fs.writeFileSync(filePath, reportContent, 'utf8');
        console.log(`Report saved to ${filePath}`);

        // Generate OpenAI summary and append it to the report
        const summary = await generateSummary(reportContent);
        if (summary) {
            fs.appendFileSync(filePath, `\n## OpenAI Summary\n${summary}`, 'utf8');
            console.log('Summary appended to the report.');
        }

    } catch (error) {
        console.error('Error saving report to file:', error);
    }
}

// Function to generate a summary using OpenAI
async function generateSummary(reportContent) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: `Summarize the following website audit report:\n\n${reportContent}`,
                },
            ],
        });

        return response.choices[0]?.message?.content || "No summary available.";
    } catch (error) {
        console.error('OpenAI API error:', error);
        return null;
    }
}

function formatReport(report, url) {
    const recommendations = [];

    if (report.lighthouse.performanceScore < 90) {
        recommendations.push('Consider optimizing images and reducing JavaScript to improve performance.');
    }
    if (report.lighthouse.accessibilityScore < 90) {
        recommendations.push('Review accessibility issues and apply fixes from the Pa11y results.');
    }
    if (!report.security.httpsRedirect) {
        recommendations.push('Ensure that HTTP traffic is redirected to HTTPS.');
    }

    const simplifiedAudits = Object.values(report.lighthouse.audits)
        .filter(audit => audit.score < 0.9)
        .map(audit => ({
            title: audit.title,
            description: audit.description,
            score: audit.score * 100
        }));

    return `
# Website Audit Report for: ${url}

## Summary
- **SEO Score**: ${report.lighthouse.seoScore}
- **Accessibility Score**: ${report.lighthouse.accessibilityScore}
- **Performance Score**: ${report.lighthouse.performanceScore}
- **Best Practices Score**: ${report.lighthouse.bestPracticesScore}

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
- **DNS TXT Records**: ${report.security.dnsRecords ? report.security.dnsRecords.join('\n') : 'No DNS TXT records found'}

`;
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