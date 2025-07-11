require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const https = require('https');
const axios = require('axios');
const admin = require('firebase-admin');
const serviceAccount = require('./bixx-b9a19-firebase-adminsdk-fbsvc-e2295a581a.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const db = getFirestore();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Cerebras client
const cerebras = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

// Remove all chat and message saving logic, in-memory store, helper functions, and endpoints
// Only keep authentication and WebSocket/AI logic

// Serve static files from the 'public' folder
app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// AUTH ENDPOINTS
// Get current user (by Firebase ID token)
app.get('/api/user', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    res.json({ user: decoded });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

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

// Get all chats for the authenticated user
app.get('/api/chats', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email = decoded.email;
    const userChatsSnap = await db.collection('chats').doc(email).collection('userChats').orderBy('updatedAt', 'desc').get();
    const chats = userChatsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ chats });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Get all messages for a chat (authenticated)
app.get('/api/chats/:chatId/messages', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email = decoded.email;
    const chatDoc = await db.collection('chats').doc(email).collection('userChats').doc(req.params.chatId).get();
    if (!chatDoc.exists) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const snap = await db.collection('chats').doc(email).collection('userChats').doc(req.params.chatId)
      .collection('messages').orderBy('createdAt').get();
    const messages = snap.docs.map(doc => doc.data());
    res.json({ messages });
  } catch (err) {
    res.status(401).json({ error: err.message });
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

// Helper: get user from ws connection
function getUser(ws) {
    const info = connectionData.get(ws);
    return info && info.currentUser ? info.currentUser : null;
}

wss.on('connection', (ws) => {
    // Track user and chat state for this connection
    connectionData.set(ws, {
        currentUser: null,
        currentChatId: null
    });

    ws.on('message', async (message) => {
        try {
            let parsedMessage = null;
            try {
                parsedMessage = JSON.parse(message);
            } catch (e) {}

            let info = connectionData.get(ws);
            // AUTH: Require auth before anything else
            if (parsedMessage && parsedMessage.type === 'auth' && parsedMessage.token) {
                try {
                    const decoded = await admin.auth().verifyIdToken(parsedMessage.token);
                    info.currentUser = decoded;
                    connectionData.set(ws, info);
                    ws.send(JSON.stringify({ role: 'auth_success', user: decoded }));
                } catch (err) {
                    ws.send(JSON.stringify({ role: 'error', content: 'Authentication failed' }));
                }
                return;
            }
            // Require auth for all other actions
            const user = getUser(ws);
            if (!user) {
                ws.send(JSON.stringify({ role: 'error', content: 'User not authenticated' }));
                return;
            }
            const email = user.email;

            // Handle chat message
            if (parsedMessage && parsedMessage.type === 'message' && parsedMessage.content) {
                ws.send(JSON.stringify({ role: 'ai_start' }));
                let chatId = parsedMessage.chatId || info.currentChatId;
                // If no chatId, create a new chat
                if (!chatId) {
                    const chatRef = await db.collection('chats').doc(email).collection('userChats').add({
                        title: parsedMessage.content.slice(0, 40),
                        createdAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    chatId = chatRef.id;
                    info.currentChatId = chatId;
                    connectionData.set(ws, info);
                } else {
                    // Update chat updatedAt
                    await db.collection('chats').doc(email).collection('userChats').doc(chatId).update({
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    info.currentChatId = chatId;
                    connectionData.set(ws, info);
                }
                // Save user message
                await db.collection('chats').doc(email).collection('userChats').doc(chatId).collection('messages').add({
                    role: 'user',
                    content: parsedMessage.content,
                    createdAt: FieldValue.serverTimestamp()
                });
                // Load full chat history
                const msgSnap = await db.collection('chats').doc(email).collection('userChats').doc(chatId).collection('messages').orderBy('createdAt').get();
                const history = msgSnap.docs.map(doc => ({
                    role: doc.data().role,
                    content: doc.data().content
                }));
                // Send to Cerebras
                try {
                    const stream = await cerebras.chat.completions.create({
                        messages: history,
                        model: 'llama-3.3-70b',
                        stream: true,
                        max_completion_tokens: 8000,
                        temperature: 0.7,
                        top_p: 1
                    });
                    let accumulatedContent = '';
                    for await (const chunk of stream) {
                        const content = chunk.choices[0]?.delta?.content || '';
                        if (content) {
                            accumulatedContent += content;
                            ws.send(JSON.stringify({ role: 'ai', content: accumulatedContent }));
                        }
                    }
                    // Save AI response
                    await db.collection('chats').doc(email).collection('userChats').doc(chatId).collection('messages').add({
                        role: 'assistant',
                        content: accumulatedContent,
                        createdAt: FieldValue.serverTimestamp()
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ role: 'ai', content: 'Sorry, I encountered an error.' }));
                }
                ws.send(JSON.stringify({ role: 'ai_complete', promptDetected: false }));
                return;
            }
        } catch (error) {
            ws.send(JSON.stringify({ role: 'ai', content: 'Sorry, I encountered an error' }));
        }
    });

    ws.on('close', () => {
        connectionData.delete(ws);
    });
    ws.on('error', (error) => {
        connectionData.delete(ws);
    });
});
