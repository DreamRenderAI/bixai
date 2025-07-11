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
const serviceAccount = {
    "type": "service_account",
    "project_id": "bixxproject",
    "private_key_id": "fa861b7e7acf79119194c866f35484e5fed373ec",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCr1txjib7XfLMK\nHWp9634dRdLouOnrKBJTCYd4+Ua1bZpYe7LwyNM/NAMhTktpdXGy++vboQ+jv4Ap\nEvHjgOAiHTRTj1q5dLOM7Pz+UYjt5bTRyaYCWF9OHDAPrExRKvGHuzDbR1+XEWWJ\nxjJqz2dUSMfDd3Q/9/4RaFMoEEm/lpmGK6OUneZXHBdwBfueA2ir6NpRjLLG+qy8\nuzjvUbmnKHvureyeiHdCaRUZuO7jjRekw94TGBsxikkldgqcjrCYIDeJCKh9ybWk\ne0dwVI3g+vFLuGAFZQ+CCLxfATYtuRd9CfmYT7PHw0liM647QvmZbbK8oc9ii7Z1\n8HKXUZFfAgMBAAECggEALzahJg4mK8G81YYgiMlnxLY3DS8lQjGn2z3OhYwEA/xB\nwJb4ItUiyYZKZ9/Bs4+LtlAmTRlzGRwYI/DrGgWCT40zn9PO6w6n+IvytROE6kxH\nQq7DWHiccvMmt1+xNkn0w8TIVy9Ekda7Tb/xgUxMCSnYDRoojBzgpzrBQkw7XxKX\nvR0fXC/mlzEqxopVQVEBc5WOsng4nRpXTPxgPkzUEVh53IrEzhGH2rJqsBxcRVuD\nTtw6fHxbXmhfmBg+aO8ZfNJgUzLyyVYax0ZbyeNSelqQsF5bLq9hXbDlRlZFLvpB\njqshUE0+tFOiV5Fo90VUvtrS/6mpBsMGhRooTwStuQKBgQDhZih53q1QlnvoV61w\nv0fQN3Ambpkw8j1H1Fb9fS1n30zlRv7LSo9+5vWdZpKPNBMDWoJNyX5xJ72h/9sZ\nP6Eoncj+YMGvZx4jidlEdX3XdV41caPwYY1G6KfEGJJBHPimL0p4FfZugUv+NKiA\nnkNufL7m3zPNHJOAoxXkUhpVCQKBgQDDKzXVP+uG33kfe1aBVdqkT4yx7JdvpItm\nscnNjWjDLHiy1xMtkj0V1xmuYqxivwMZ6FmAEeK9+yjUUng13ZIv/x6dqCfzlvA1\njXDl1qIh8RMVVc2reNepehciROPmT8qJRlhs1qe8EKu7InU2WNvNKXhXAf5qkFpG\nlXKWYsX1JwKBgAwaTywUD9xW6DpWkuKN8s40W9pEcAdXyoCT30PnN8vvCpL5F+9U\nhpX60s9r1YzI8AhrELoaiqaKyrzrHxmg+AdVSZiXG29OqyifW0I4yNQL4k4eVv4u\nTsay8WcvJpNGefd6bJY8H6pZWPpCW5XkaZyCKEH/VCm8UhNDLoa+/dj5AoGBAKTY\nCF4X4R1H/4wBpu0S0NtbfWCCjt3zQvL4U5TUTZocI84aLs6c6A9cYQqTuTqmTz5A\nq+eqM7N3QeMjzPjiLqlveDJ9Z1EtObJhxuu6P7MfZZjtogukw7MXthZxzXQoDM+p\npOI44+/KvOIQlqPSpcRBtKz4uCTVzAo2DFTNFJqdAoGBAMg37mxHLm6BV5AaiZ6F\nNxzD2rdSyZOp47YWp1fS0JH7CTajCkliBYJ4vow+/gMnesNZbxkMEdCb80P4inv6\nTMsNkYTkFdw9ErqQK2ImYSGzDtJg5qo1TS3WHHxVE7bAmyDVFDySRGm0ClC2LG21\nxHiaETyJWsQJPsmWC8UAQJ/t\n-----END PRIVATE KEY-----\n",
    "client_email": "firebase-adminsdk-fbsvc@bixxproject.iam.gserviceaccount.com",
    "client_id": "115601538713502378971",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40bixxproject.iam.gserviceaccount.com",
    "universe_domain": "googleapis.com"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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
