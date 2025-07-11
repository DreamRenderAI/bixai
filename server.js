require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const https = require('https');
const axios = require('axios');
const bcrypt = require('bcrypt');

const mongoose = require('mongoose');
const mongoUri = 'mongodb+srv://bixxdata:E0kL3e7NcpqibJXi@bixx.tk35jpy.mongodb.net/bixx?retryWrites=true&w=majority&appName=Bixx';
mongoose.connect(mongoUri);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Mongoose Schemas
const MessageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  role: String,
  content: String,
  createdAt: { type: Date, default: Date.now }
});
const ChatSchema = new mongoose.Schema({
  ownerEmail: { type: String, required: true },
  title: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Chat = mongoose.model('Chat', ChatSchema);
const Message = mongoose.model('Message', MessageSchema);
const User = mongoose.model('User', UserSchema);

const app = express();
const port = process.env.PORT || 3000;

// Initialize Cerebras client
const cerebras = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

// Serve static files from the 'public' folder
app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// AUTH ENDPOINTS
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const user = new User({
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    res.json({ success: true, user: { email: user.email } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    res.json({ success: true, user: { email: user.email } });
  } catch (err) {
    console.error('Signin error:', err);
    res.status(500).json({ error: 'Failed to authenticate' });
  }
});

app.get('/api/user', async (req, res) => {
  // In production, verify the token! For now, just return dummy user
  res.json({ user: { email: req.query.email || 'test@example.com' } });
});

// Add Wikipedia extract endpoint (unchanged)
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

// Get all chats for the authenticated user (by email query param for now)
app.get('/api/chats', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(401).json({ error: 'No email provided' });
    const chats = await Chat.find({ ownerEmail: email }).sort({ updatedAt: -1 });
    res.json({ chats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all messages for a chat (by chatId param)
app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const messages = await Message.find({ chatId }).sort({ createdAt: 1 });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set up WebSocket server
const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
const wss = new WebSocket.Server({ server });

// Map to store conversation history and user data for each WebSocket connection
const connectionData = new Map();
// Map to store guest chat history (in memory only)
const guestChats = new Map();

// Function to process code blocks in the content (unchanged)
function processCodeBlocks(content) {
    const codeBlockRegex = /```(?:(\w+)\n)?([\s\S]*?)```/g;
    let lastIndex = 0;
    let result = '';
    let match;
    codeBlockRegex.lastIndex = 0;
    while ((match = codeBlockRegex.exec(content)) !== null) {
        result += content.slice(lastIndex, match.index);
        const language = match[1] || 'text';
        const code = match[2]
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .trim();
        const lines = code.split('\n');
        const formattedLines = lines.map(line => {
            const indentMatch = line.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '';
            const content = line.trim();
            return indent + content;
        });
        const formattedCode = formattedLines.join('\n');
        result += `<pre><button class="copy-button" onclick="copyCode(this)">Copy</button><code class="language-${language}">${formattedCode}</code></pre>`;
        lastIndex = match.index + match[0].length;
    }
    result += content.slice(lastIndex);
    result = result.replace(/([^<]+)(?:\s*\1\s*)+/g, '$1');
    result = result.replace(/\n/g, '<br>');
    return result;
}

// Helper: get user from ws connection
function getUser(ws) {
    const info = connectionData.get(ws);
    return info && info.currentUser ? info.currentUser : null;
}

// Read system content from file
const systemContent = fs.readFileSync(path.join(__dirname, 'system.txt'), 'utf8');

wss.on('connection', (ws) => {
    connectionData.set(ws, {
        currentUser: null,
        currentChatId: null,
        isGuest: false,
        guestMessages: []
    });

    ws.on('message', async (message) => {
        try {
            console.log('WebSocket message received:', message.toString());
            let parsedMessage = null;
            try {
                parsedMessage = JSON.parse(message);
                console.log('Parsed message:', parsedMessage);
            } catch (e) {
                console.error('Failed to parse message:', e);
            }

            let info = connectionData.get(ws);
            // AUTH: Require auth before anything else
            if (parsedMessage && parsedMessage.type === 'auth' && parsedMessage.email) {
                console.log('Processing auth message for email:', parsedMessage.email);
                info.currentUser = { email: parsedMessage.email };
                info.isGuest = parsedMessage.isGuest || false;
                if (info.isGuest) {
                    info.guestMessages = [];
                    console.log('Guest user authenticated');
                }
                connectionData.set(ws, info);
                console.log('Sending auth_success response');
                ws.send(JSON.stringify({ role: 'auth_success', user: info.currentUser }));
                
                // Send welcome message for guests
                if (info.isGuest) {
                    ws.send(JSON.stringify({ 
                        role: 'ai', 
                        content: '👋 Welcome! You can chat with me, but your messages won\'t be saved. Sign in to save your conversations!' 
                    }));
                    ws.send(JSON.stringify({ role: 'ai_complete', promptDetected: false }));
                }
                return;
            }
            // Require auth for all other actions
            const user = getUser(ws);
            if (!user) {
                console.log('User not authenticated, rejecting message');
                ws.send(JSON.stringify({ role: 'error', content: 'User not authenticated' }));
                return;
            }
            const email = user.email;
            const isGuest = info.isGuest;

            // Handle chat message
            if (parsedMessage && parsedMessage.type === 'message' && parsedMessage.content) {
                console.log('Processing message from:', email, 'content:', parsedMessage.content.substring(0, 50) + '...');
                ws.send(JSON.stringify({ role: 'ai_start' }));
                
                if (isGuest) {
                    // Guest mode: store in memory only
                    info.guestMessages.push({ role: 'user', content: parsedMessage.content });
                    const history = info.guestMessages;
                    
                    // Send to Cerebras
                    try {
                        const stream = await cerebras.chat.completions.create({
                            messages: [
                                { role: 'system', content: systemContent },
                                ...history
                            ],
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
                        // Store AI response in memory
                        info.guestMessages.push({ role: 'assistant', content: accumulatedContent });
                        connectionData.set(ws, info);
                    } catch (err) {
                        ws.send(JSON.stringify({ role: 'ai', content: 'Sorry, I encountered an error.' }));
                    }
                    ws.send(JSON.stringify({ role: 'ai_complete', promptDetected: false }));
                    return;
                } else {
                    // Regular user: save to MongoDB
                    let chatId = parsedMessage.chatId || info.currentChatId;
                    let chat;
                    // If no chatId, create a new chat
                    if (!chatId) {
                        chat = new Chat({
                            ownerEmail: email,
                            title: parsedMessage.content.slice(0, 40),
                            createdAt: new Date(),
                            updatedAt: new Date()
                        });
                        await chat.save();
                        chatId = chat._id;
                        info.currentChatId = chatId;
                        connectionData.set(ws, info);
                    } else {
                        chat = await Chat.findById(chatId);
                        if (chat) {
                            chat.updatedAt = new Date();
                            await chat.save();
                        }
                        info.currentChatId = chatId;
                        connectionData.set(ws, info);
                    }
                    // Save user message
                    const userMsg = new Message({
                        chatId: chatId,
                        role: 'user',
                        content: parsedMessage.content,
                        createdAt: new Date()
                    });
                    await userMsg.save();
                    // Load full chat history
                    const historyDocs = await Message.find({ chatId }).sort({ createdAt: 1 });
                    const history = historyDocs.map(doc => ({
                        role: doc.role,
                        content: doc.content
                    }));
                    // Send to Cerebras
                    try {
                        const stream = await cerebras.chat.completions.create({
                            messages: [
                                { role: 'system', content: systemContent },
                                ...history
                            ],
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
                        const aiMsg = new Message({
                            chatId: chatId,
                            role: 'assistant',
                            content: accumulatedContent,
                            createdAt: new Date()
                        });
                        await aiMsg.save();
                    } catch (err) {
                        ws.send(JSON.stringify({ role: 'ai', content: 'Sorry, I encountered an error.' }));
                    }
                    ws.send(JSON.stringify({ role: 'ai_complete', promptDetected: false }));
                    return;
                }
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
