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

async function saveReportToFile(report, url) {
    const uniqueId = generateUniqueId();
    const fileName = `${url.replace(/[^a-zA-Z0-9]/g, '_')}_${uniqueId}.txt`;
    const filePath = path.join(__dirname, fileName);

    try {
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`Report saved to ${filePath}`);
    } catch (error) {
        console.error('Error saving report to file:', error);
    }
}

// async function auditWebsite(inputUrl) {
//     try {
//         let url;

//         // Attempt to create a valid URL, adding "https://" if necessary
//         try {
//             if (!/^https?:\/\//i.test(inputUrl)) {
//                 inputUrl = `https://${inputUrl}`;
//             }

//             // Use the URL constructor to validate the input
//             url = new URL(inputUrl);
//         } catch (err) {
//             console.error('Invalid URL:', inputUrl);
//             process.exit(1);  // Exit if URL is invalid
//         }

//         console.log(`Auditing website: ${url.href}`);
//         const lighthouseResults = await runLighthouse(url.href);
//         const pa11yResults = await runPa11y(url.href);
//         const securityResults = await checkSecurity(url.href);

//         const finalReport = {
//             url: url.href,
//             lighthouse: lighthouseResults,
//             pa11y: pa11yResults ? pa11yResults.issues : null,
//             security: securityResults
//         };

//         await saveReportToFile(finalReport, url.href);
//         console.log('Audit complete. Check the generated text file for results.');

//         // Exit the process successfully
//         process.exit(0);
//     } catch (error) {
//         console.error('Error auditing website:', error);
//         process.exit(1);  // Exit with an error code in case of failure
//     }
// }

function formatUrl(inputUrl) {
    // Debug log to check initial URL
    console.log('Initial URL:', inputUrl);

    // Trim any leading or trailing spaces
    inputUrl = inputUrl.trim();

    // Add https:// if not present
    if (!/^https?:\/\//i.test(inputUrl)) {
        inputUrl = `https://${inputUrl}`;
    }

    // Debug log to check URL after adding https://
    console.log('URL after adding https://:', inputUrl);

    try {
        const url = new URL(inputUrl);

        // Add trailing slash only if the pathname is empty or just a "/"
        if (url.pathname === '' || url.pathname === '/') {
            url.pathname = '/';
        }
        
        // Debug log to check the final formatted URL
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
            pa11y: pa11yResults ? pa11yResults.issues : null,
            security: securityResults
        };

        await saveReportToFile(finalReport, formattedUrl);
        console.log('Audit complete. Check the generated text file for results.');

        // Exit the process successfully
        process.exit(0);
    } catch (error) {
        console.error('Error auditing website:', error);
        process.exit(1);  // Exit with an error code in case of failure
    }
}

const url = process.argv[2];
if (!url) {
    console.error('Please provide a URL to audit.');
    process.exit(1);
}
auditWebsite(url);

