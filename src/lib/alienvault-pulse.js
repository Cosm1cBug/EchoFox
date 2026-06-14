/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
const axios = require('axios'); // Importing axios for HTTP requests
const fs = require('fs'); // Importing fs for file system operations
const path = require('path'); // Importing path for file path manipulation
const { config } = require('../lib/configLoader'); // Importing the config for API keys
const cron = require('node-cron'); // node-cron v4

const API_KEY = config.alienvault.key; // Accessing the API key from the config
const OTX_URL = 'https://otx.alienvault.com/api/v1/pulses/subscribed'; // URL for fetching pulses

const IOC = path.join(__dirname, '../store/AlienVault/IOC'); // Directory for storing IOC files
const SUBSCRIBERS = path.join(__dirname, '../store/AlienVault/pulse-subscribers.json'); // Path for subscribers file
const SENT_PULSES = path.join(__dirname, '../store/AlienVault/sent-pulses.json'); // Path for sent pulses file

// Ensure the directory for storing IOCs exists, create it if not
if (!fs.existsSync(IOC)) {
  fs.mkdirSync(IOC);
}

// Load the sent pulses from the file
function loadSentPulses() {
  if (!fs.existsSync(SENT_PULSES)) return []; // Return empty array if no sent pulses file exists
  return JSON.parse(fs.readFileSync(SENT_PULSES, 'utf8')); // Parse and return sent pulses from the file
}

// Save the sent pulses to the file
function saveSentPulses(sentPulses) {
  fs.writeFileSync(SENT_PULSES, JSON.stringify(sentPulses, null, 2), 'utf8'); // Save the sent pulses as JSON
}

// Load the list of subscribers from the subscribers file
function loadSubscribers() {
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIBERS, 'utf8')); // Parse and return subscribers
  } catch (error) {
    console.error('[ AlienVault ] - Error loading subscribers:', error.message);
    return []; // Return empty array in case of an error while reading the subscribers file
  }
}

// Fetch pulses from AlienVault API
async function fetchPulses() {
  try {
    const response = await axios.get(OTX_URL, {
      headers: { 'X-OTX-API-KEY': API_KEY }, // Sending API key in the headers
    });
    return response.data; // Return the response data if successful
  } catch (error) {
    console.error(`[ AlienVault ] - Error fetching pulses: ${error.message}`);
    return null; // Return null if fetching the pulses fails
  }
}

// Save the indicators for a specific pulse to a file
async function saveIndicatorsToFile(pulse) {
  const indicators = [];

  // Check if the pulse has indicators and store them
  if (pulse.indicators && pulse.indicators.length > 0) {
    pulse.indicators.forEach((indicator) => {
      indicators.push(`Indicator Type: ${indicator.type}\nIndicator: ${indicator.indicator}\n`);
    });
  } else {
    console.log(`[ AlienVault ] - No indicators found for pulse ${pulse.id}`);
  }

  // Create a filename for the IOC file
  const pulseFileName = `IOC_${pulse.id}.txt`;
  const pulseFilePath = path.join(IOC, pulseFileName);

  // Save the indicators to a text file
  fs.writeFileSync(pulseFilePath, indicators.join('\n'), 'utf8');

  return pulseFilePath; // Return the path of the saved IOC file
}

// Exponential Backoff Delay
function exponentialDelay(attempt, baseDelay = 5000) {
  return new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
}

// Send message with retry mechanism
async function sendWithRetry(sock, userId, message, retries = 3) {
  let attempt = 0;

  while (attempt < retries) {
    try {
      await sock.sendMessage(userId, { text: message }); // Send the message
      //console.log(`[AlienVault] - Sent message to ${userId}`);
      return; // Return if the message was sent successfully
    } catch (error) {
      attempt++; // Increment the attempt counter
      console.error(
        `[ AlienVault ] - Error sending message to ${userId} (Attempt ${attempt}/${retries}): ${error.message}`,
      );
      if (attempt < retries) {
        console.log(`[ AlienVault ] - Retrying... (${attempt + 1})`);
        await exponentialDelay(attempt);
      }
    }
  }

  console.error(`[ AlienVault ] - Failed to send message to ${userId} after ${retries} attempts.`);
}

// Main function to send pulses to all subscribers
async function sendPulses(sock) {
  const subscribers = await loadSubscribers(); // Load the list of subscribers
  if (subscribers.length === 0) {
    //console.log("[AlienVault] - No subscribers. Skipping pulse sending.");
    return; // Exit if there are no subscribers
  }

  const pulses = await fetchPulses(); // Fetch pulses from the AlienVault API
  if (!pulses || pulses.results.length === 0) return; // Exit if there was an error fetching the pulses

  const sentPulses = await loadSentPulses(); // Load the list of sent pulses
  const newPulses = pulses.results.filter((pulse) => !sentPulses.includes(pulse.id)); // Filter out already sent pulses

  if (newPulses.length === 0) {
    return; // Exit if there are no new pulses to send
  }

  // Iterate over each pulse and send it to all subscribers
  for (const pulse of newPulses) {
    let pulseMessage = `\`</> AlienVault Pulse Notification </>\`\n\n`;
    pulseMessage += `*Name*: ${pulse.name}\n`;
    pulseMessage += `*ID*: ${pulse.id}\n`;
    pulseMessage += `*Description*: ${pulse.description}\n`;
    pulseMessage += `*Author*: ${pulse.author_name}\n`;
    pulseMessage += `*Adversary*: ${pulse.adversary}\n\n`;
    pulseMessage += `> You're subscribed to AlienVault Pulses. To unsubscribe, use $alienvault off`;

    // Create a unique IOC file for this pulse
    const pulseFilePath = await saveIndicatorsToFile(pulse, pulse.id); // Save indicators and get file path

    // Add the pulse to the sent pulses list and save it
    sentPulses.push(pulse.id);
    saveSentPulses(sentPulses);

    // Send the pulse message and IOC file to each subscriber
    for (const userId of subscribers) {
      await sendWithRetry(sock, userId, pulseMessage); // Send pulse message

      // Send the IOC file for this pulse
      if (fs.existsSync(pulseFilePath)) {
        //console.log(`[AlienVault] - Sending IOC file: ${pulseFilePath}`);
        await sock.sendMessage(userId, {
          document: fs.readFileSync(pulseFilePath), // Read the IOC file
          mimetype: 'text/plain', // File type is plain text
          fileName: `IOC_${pulse.id}.txt`, // File name for the IOC file
          caption: `Indicators for Pulse: ${pulse.name}`, // Caption for the file
        });
      } else {
        console.error(`[ AlienVault ] - IOC file not found for pulse: ${pulse.id}`);
      }

      await exponentialDelay(subscribers.indexOf(userId));
    }
  }
}

// Schedule the pulse sending task to run every day at specific hours
function AlienVaultService(sock) {
  console.log('[ AlienVault ] - Service started...');
  cron.schedule('0 5,8,10,12,14,16,18,20 * * *', async () => {
    //console.log('Sending pulses...');
    await sendPulses(sock); // Send pulses when the scheduled task is triggered
  });
}

module.exports = { AlienVaultService }; // Export the service to be used elsewhere
