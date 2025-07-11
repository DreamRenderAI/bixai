require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const https = require('https');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Cerebras client
const cerebras = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

// Initialize Firebase Admin SDK
const firebase = {
  "type": "service_account",
  "project_id": "bixxproject",
  "private_key_id": "54a5d1a7e3a98bb582384595e57699219a5d9aa3",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCzf+SQKiZgndjH\ngzVNr8A+98jSBxwPQz+SopNBUB2l5X/jEZt3TZUaLjHRH/i0ldh0PU47vrLxPI2V\nK+Y09cMRdqPE73jmMz0BYt3MUZxBPemB+pB4DZ1IGBxWoPShsFju57tvidMTWEyd\n0fHh20DQvOW+pq7NCfKI9b13o1Ly/E5EiHmkTPkKSUe8Hnv+nRI0EEVa3P8847GS\nYVZVpNtJF8e0JziIDlG3SA7Pdm0UektUn6SzBceMLFya1b3/Mp9h1pHY8u7M8u4h\nabQpYnESLRPfhG4nm9D6piimGkum+RTTj3950y5zIp/uY6W+tKbbOUosI/MeMa5x\nFb+MEmaLAgMBAAECggEAA1ANblGw0qCnIwt7XNss/5yAEsw5ythRYInqkM6DNZAW\nO6EUDvAaG9kVZ0ghRWfsjjyhaH3c/JHDBSlBvuF4P6bCX/yRbSIt8owaDs7ExPl5\nCUKQDv8lU3LKdxjSWvePtJ0HOwg+ooFDLLh2r9XljNSnosydtkAEP13VqNMVUVGp\n0IlJFW2TI9xWhwjESGYQY1w8fy167GWr44MpEDJOLZwT+44pRwb6CLxcCLnx3OXP\ndPJEOy1Ab4/qlZiJKdGqGvYYGWqHXO7RoIjjSja5zMiprou9fxaNWP7KYdW+VCyt\nyBB28j18avZX/Az/74AbIaOkDesPMXuPIkALP8LfzQKBgQDXIutV7rQThnv1QnvC\nKlfHhdG2yMYlXtlBlg8pk4MX9LTN2zhMg1V2U7mXBcd5SIQtxoWIkulGFT7J02xQ\njT5G52c6agroeySksJuWUs41+9XqTl8wOjnYj73Rxlmvp514yoXuJ2eIiT1zqYZy\nTMnLAaisUslR/DNcUjNPqUzyTQKBgQDVmB73UmbuT/NWoSdDKPdXSlDKK6bc20Tm\neZypj5LQk4Mg3rkyP7iGyWLqRscP+wTAKOHgjkhmn5j8LpHMnbK/bFFF+COnMAIG\nRTNTeM+0J0fuJx8YSd3o2cl2mJvaIuorl/XGgrFbGoVouDiIvjYTQJWnyNIWK60g\nGp0ei2+4NwKBgBM3fUn5voAX/S6VN7TKT3j1DRyEpp5j8IgZPVV7ZbRYGWZh9I9x\nE8s0A1noHD9LKPNlzju607d84lTo273+P9fZh7ECE+NcTJOhauRslRrhWeRKB9qo\n+M3NWSlJzG0STdCiVoBFaMwbZi/Urru6/DNz/HsYEf+OxY+zj/3Ho6XpAoGBAKwN\noIwK5Xz8DADxSUYxHqRC6bcg2IW5XtPkjEyNqW64FH2Ky1VtvL9eQ36ByuHViusb\nQ2/2TN3Vm48wGCPht9W4c/NPwbBv3IGehoyrmWv95FQzUTnoboedv0n3/jsFuumo\nu8LPDfxb7bEADBIiXj693I9OFeTkA84DgiLToQebAoGBAKibqE/V9o9Mt3wodpwY\njYC3/w+Q1NN5qKB7cTR6dg7biCHyfEa+EDv4umEgAtPZLdkOVWuEYYE2owPYBt8b\nzunJN0MroFoFMXxN0+ZmAaNSM+rYQdZWgKOyTEjrvHcBs+9OUcWuLaUPTqatD5RF\nShBFEs465z60/AMEd6Fq/1kw\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@bixxproject.iam.gserviceaccount.com",
  "client_id": "115601538713502378971",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40bixxproject.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};
admin.initializeApp({
    credential: admin.credential.cert(firebase),
    projectId: "bixxproject"
});

const db = admin.firestore();

// Firebase helper functions
async function saveMessageToFirebase(uid, chatId, message) {
    try {
        await db.collection('users').doc(uid).collection('chats').doc(chatId).collection('messages').add({
            ...message,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Message saved to Firebase for user ${uid}, chat ${chatId}`);
        return true;
    } catch (error) {
        console.error('Error saving message to Firebase:', error);
        return false;
    }
}

async function createChatSession(uid, title = "New Chat") {
    try {
        const chatRef = await db.collection('users').doc(uid).collection('chats').add({
            title,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Chat session created for user ${uid}: ${chatRef.id}`);
        return chatRef.id;
    } catch (error) {
        console.error('Error creating chat session:', error);
        return null;
    }
}

async function updateChatTitle(uid, chatId, title) {
    try {
        await db.collection('users').doc(uid).collection('chats').doc(chatId).update({
            title,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Chat title updated for user ${uid}, chat ${chatId}: ${title}`);
        return true;
    } catch (error) {
        console.error('Error updating chat title:', error);
        return false;
    }
}

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Add Wikipedia extract endpoint
app.get('/wiki/:topic', async (req, res) => {
    try {
        const topic = req.params.topic;
        const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=true&titles=${encodeURIComponent(topic)}&format=json`;
        const response = await axios.get(url);
        const pages = response.data.query.pages;
        let extract = '';
        for (const pageId in pages) {
            if (pages[pageId].extract) {
                extract = pages[pageId].extract;
                break;
            }
        }
        if (!extract) {
            return res.status(404).json({ error: 'No extract found for this topic.' });
        }
        // Limit to 1500 words
        const words = extract.split(/\s+/).slice(0, 1500);
        const limitedExtract = words.join(' ');
        res.json({ extract: limitedExtract });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch Wikipedia extract.' });
    }
});

// Set up WebSocket server
const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
const wss = new WebSocket.Server({ server });

// Map to store conversation history and user data for each WebSocket connection
const connectionData = new Map();

// Function to process code blocks in the content
function processCodeBlocks(content) {
    const codeBlockRegex = /```(?:(\w+)\n)?([\s\S]*?)```/g;
    let lastIndex = 0;
    let result = '';
    let match;

    codeBlockRegex.lastIndex = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
        // Add any text before the code block
        result += content.slice(lastIndex, match.index);
        
        const language = match[1] || 'text';
        const code = match[2]
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .trim();
        
        // Format the code with proper indentation
        const lines = code.split('\n');
        const formattedLines = lines.map(line => {
            const indentMatch = line.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '';
            const content = line.trim();
            return indent + content;
        });
        
        const formattedCode = formattedLines.join('\n');
        
        // Create the code block with copy button
        result += `<pre><button class="copy-button" onclick="copyCode(this)">Copy</button><code class="language-${language}">${formattedCode}</code></pre>`;
        lastIndex = match.index + match[0].length;
    }

    // Add any remaining text
    result += content.slice(lastIndex);
    
    // Remove duplicate text content
    result = result.replace(/([^<]+)(?:\s*\1\s*)+/g, '$1');
    
    // Convert newlines to <br> tags
    result = result.replace(/\n/g, '<br>');
    
    return result;
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('Client connected');

    const systemPromptPath = path.join(__dirname, 'system.txt');
    const systemContent = fs.readFileSync(systemPromptPath, 'utf8');
    const initialHistory = [{ role: 'system', content: systemContent }];
    
    // Initialize connection data
    connectionData.set(ws, {
        history: initialHistory,
        currentUser: null,
        currentChatId: null
    });

    ws.on('message', async (message) => {
        try {
            const userMessage = message.toString('utf8');
            console.log('Received user message:', userMessage);

            let parsedMessage = null;
            try {
                parsedMessage = JSON.parse(userMessage);
            } catch (e) {
                // Not JSON, treat as regular message
            }

            let connectionInfo = connectionData.get(ws);
            if (!connectionInfo) {
                console.error('Connection data not found');
                return;
            }

            // Handle different message types
            if (parsedMessage) {
                if (parsedMessage.type === 'profile_update') {
                    const profileInfo = `User Profile:\nName: ${parsedMessage.data.name}\nOccupation: ${parsedMessage.data.occupation}`;
                    const systemMessageIndex = connectionInfo.history.findIndex(msg => msg.role === 'system');
                    if (systemMessageIndex !== -1) {
                        connectionInfo.history[systemMessageIndex].content = `${connectionInfo.history[systemMessageIndex].content}\n\n${profileInfo}`;
                    } else {
                        connectionInfo.history.unshift({ role: 'system', content: profileInfo });
                    }
                    connectionData.set(ws, connectionInfo);
                    return;
                }
                
                if (parsedMessage.type === 'auth') {
                    // Handle user authentication
                    try {
                        const decodedToken = await admin.auth().verifyIdToken(parsedMessage.token);
                        connectionInfo.currentUser = decodedToken;
                        connectionData.set(ws, connectionInfo);
                        console.log(`User authenticated: ${decodedToken.uid}`);
                        return;
                    } catch (error) {
                        console.error('Authentication error:', error);
                        ws.send(JSON.stringify({ role: 'error', content: 'Authentication failed' }));
                        return;
                    }
                }
                
                if (parsedMessage.type === 'chat_init') {
                    // Initialize or load chat
                    if (!connectionInfo.currentUser) {
                        ws.send(JSON.stringify({ role: 'error', content: 'User not authenticated' }));
                        return;
                    }
                    
                    if (parsedMessage.chatId) {
                        connectionInfo.currentChatId = parsedMessage.chatId;
                        // Send confirmation that chat is loaded
                        ws.send(JSON.stringify({ 
                            role: 'chat_loaded', 
                            chatId: parsedMessage.chatId 
                        }));
                    } else if (parsedMessage.firstMessage) {
                        // Create new chat
                        const chatId = await createChatSession(connectionInfo.currentUser.uid, parsedMessage.firstMessage);
                        if (chatId) {
                            connectionInfo.currentChatId = chatId;
                            await updateChatTitle(connectionInfo.currentUser.uid, chatId, parsedMessage.firstMessage);
                            await saveMessageToFirebase(connectionInfo.currentUser.uid, chatId, {
                                role: 'user',
                                content: parsedMessage.firstMessage
                            });
                            // Send the new chat ID back to frontend
                            ws.send(JSON.stringify({ 
                                role: 'chat_created', 
                                chatId: chatId,
                                title: parsedMessage.firstMessage
                            }));
                        }
                    }
                    connectionData.set(ws, connectionInfo);
                    return;
                }
            }

            // Regular message handling
            if (!connectionInfo.currentUser) {
                ws.send(JSON.stringify({ role: 'error', content: 'User not authenticated' }));
                return;
            }

            const messageContent = parsedMessage ? parsedMessage.content : userMessage;
            
            // Save user message to Firebase
            if (connectionInfo.currentChatId) {
                await saveMessageToFirebase(connectionInfo.currentUser.uid, connectionInfo.currentChatId, {
                    role: 'user',
                    content: messageContent
                });
            }

            // Add to conversation history
            connectionInfo.history.push({ role: 'user', content: messageContent });
            connectionData.set(ws, connectionInfo);

            const stream = await cerebras.chat.completions.create({
                messages: connectionInfo.history,
                model: 'llama-3.3-70b',
                stream: true,
                max_completion_tokens: 8000,
                temperature: 0.7,
                top_p: 1
            });

            let fullResponse = '';
            let promptDetected = false;
            let accumulatedContent = '';
            let lastSentContent = '';
            let isFirstChunk = true;

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    let visibleContent = content;
                    
                    accumulatedContent += visibleContent;
                    
                    if (visibleContent && accumulatedContent !== lastSentContent) {
                        if (isFirstChunk) {
                            ws.send(JSON.stringify({ role: 'ai_start' }));
                            isFirstChunk = false;
                        }
                        ws.send(JSON.stringify({ role: 'ai', content: accumulatedContent }));
                        lastSentContent = accumulatedContent;
                    }
                    
                    fullResponse += content;
                }
            }

            ws.send(JSON.stringify({ role: 'ai_complete', promptDetected: false }));

            if (fullResponse.length > 0) {
                // Save AI message to Firebase
                if (connectionInfo.currentChatId) {
                    console.log('Backend saving AI message to Firebase:', {
                        uid: connectionInfo.currentUser.uid,
                        chatId: connectionInfo.currentChatId,
                        contentLength: fullResponse.length
                    });
                    
                    const saveResult = await saveMessageToFirebase(connectionInfo.currentUser.uid, connectionInfo.currentChatId, {
                        role: 'assistant',
                        content: fullResponse
                    });
                    
                    if (saveResult) {
                        console.log('Backend successfully saved AI message to Firebase');
                    } else {
                        console.error('Backend failed to save AI message to Firebase');
                    }
                } else {
                    console.warn('Backend cannot save AI message - no chat ID');
                }
                
                // Add to conversation history
                connectionInfo.history.push({ role: 'assistant', content: fullResponse });
                connectionData.set(ws, connectionInfo);
            }
        } catch (error) {
            console.error('Error or file:', error);
            ws.send(JSON.stringify({ role: 'ai', content: 'Sorry, I encountered an error' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        connectionData.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        connectionData.delete(ws);
    });
});
