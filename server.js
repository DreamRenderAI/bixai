require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const https = require('https');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Cerebras client
const cerebras = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

const firebaseConfig = {

    apiKey: "AIzaSyBqPrOTa6ntMKuG4TyC3BOxAl9juegddEs",
  
    authDomain: "bixx-b9a19.firebaseapp.com",
  
    projectId: "bixx-b9a19",
  
    storageBucket: "bixx-b9a19.firebasestorage.app",
  
    messagingSenderId: "144965345442",
  
    appId: "1:144965345442:web:6ee6e146210491448ef7fb",
  
    measurementId: "G-7YJXNH8JJE"
  
  };
  
// Serve static files from the 'public' folder
app.use(express.static('public'));

// Set up WebSocket server
const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
const wss = new WebSocket.Server({ server });

// Map to store conversation history for each WebSocket connection
const conversationHistories = new Map();

// Function to convert image URL to base64
async function getBase64FromUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to fetch image: ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const base64 = buffer.toString('base64');
                const mimeType = response.headers['content-type'];
                const base64Data = `data:${mimeType};base64,${base64}`;
                
                // Log the base64 data in the console
                console.log('Image converted to base64:');
                console.log(base64Data);
                
                resolve(base64Data);
            });
        }).on('error', reject);
    });
}

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
    conversationHistories.set(ws, initialHistory);

    ws.on('message', async (message) => {
        try {
            const userMessage = message.toString('utf8');
            console.log('Received user message:', userMessage);

            // Check if this is an image generation request
            const isImageRequest = userMessage.toLowerCase().includes('generate') && 
                                 (userMessage.toLowerCase().includes('image') || 
                                  userMessage.toLowerCase().includes('picture') || 
                                  userMessage.toLowerCase().includes('photo'));

            try {
                const parsedMessage = JSON.parse(userMessage);
                if (parsedMessage.type === 'profile_update') {
                    const history = conversationHistories.get(ws);
                    if (history) {
                        const profileInfo = `User Profile:\nName: ${parsedMessage.data.name}\nOccupation: ${parsedMessage.data.occupation}`;
                        const systemMessageIndex = history.findIndex(msg => msg.role === 'system');
                        if (systemMessageIndex !== -1) {
                            history[systemMessageIndex].content = `${history[systemMessageIndex].content}\n\n${profileInfo}`;
                        } else {
                            history.unshift({ role: 'system', content: profileInfo });
                        }
                        conversationHistories.set(ws, history);
                    }
                    return;
                }
            } catch (e) {
                console.log('Message is not JSON, treating as regular message');
            }

            const history = conversationHistories.get(ws);
            if (!history) {
                console.error('History not found for connection');
                return;
            }
            history.push({ role: 'user', content: userMessage });

            const stream = await cerebras.chat.completions.create({
                messages: history,
                model: 'llama-3.3-70b',
                stream: true,
                max_completion_tokens: 2048,
                temperature: 0.7,
                top_p: 1
            });

            let fullResponse = '';
            let promptDetected = false;
            let accumulatedContent = '';
            let lastSentContent = '';
            let isFirstChunk = true;
            let imagePrompt = null;

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    let visibleContent = content;
                    if (content.includes('_prompt:')) {
                        visibleContent = content.split('_prompt:')[0].trim();
                        const promptMatch = content.match(/_?prompt: ?([^_]+)_?/);
                        if (promptMatch) {
                            imagePrompt = promptMatch[1].trim();
                        }
                    }
                    
                    accumulatedContent += visibleContent;
                    
                    const processedContent = processCodeBlocks(accumulatedContent);
                    
                    if (visibleContent && processedContent !== lastSentContent) {
                        if (isFirstChunk) {
                            ws.send(JSON.stringify({ role: 'ai_start' }));
                            isFirstChunk = false;
                        }
                        ws.send(JSON.stringify({ role: 'ai', content: processedContent }));
                        lastSentContent = processedContent;
                    }
                    
                    fullResponse += content;
                }
            }

            ws.send(JSON.stringify({ role: 'ai_complete', promptDetected: !!imagePrompt }));

            if (fullResponse.length > 0) {
                history.push({ role: 'assistant', content: fullResponse });
                conversationHistories.set(ws, history);
            }

            // If this is an image request but no prompt was detected, generate one
            if (isImageRequest && !imagePrompt) {
                imagePrompt = userMessage.replace(/generate\s+(?:an\s+)?(?:image|picture|photo)\s+of\s+/i, '').trim();
            }

            if (imagePrompt) {
                console.log('Generating images for prompt:', imagePrompt);
                
                const imageUrls = [
                    `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?nologo=true&seed=${Math.floor(Math.random() * 1000000000) + 1}&safe=true`,
                    `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?nologo=true&seed=${Math.floor(Math.random() * 1000000000) + 1}&safe=true&width=1024&height=1024&steps=50`
                ];
                
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                ];

                let imagesGenerated = 0;
                const maxImages = 2;

                for (let i = 0; i < maxImages; i++) {
                    try {
                        const base64Image = await new Promise((resolve, reject) => {
                            https.get(imageUrls[i], {
                                headers: {
                                    'User-Agent': userAgents[i],
                                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                                    'Accept-Language': 'en-US,en;q=0.9',
                                    'Cache-Control': 'no-cache',
                                    'Pragma': 'no-cache'
                                }
                            }, (response) => {
                                if (response.statusCode !== 200) {
                                    reject(new Error(`Failed to fetch image: ${response.statusCode}`));
                                    return;
                                }

                                const chunks = [];
                                response.on('data', (chunk) => chunks.push(chunk));
                                response.on('end', () => {
                                    const buffer = Buffer.concat(chunks);
                                    const base64 = buffer.toString('base64');
                                    const mimeType = response.headers['content-type'];
                                    const base64Data = `data:${mimeType};base64,${base64}`;
                                    resolve(base64Data);
                                });
                            }).on('error', reject);
                        });

                        ws.send(JSON.stringify({ role: 'image', content: base64Image }));
                        imagesGenerated++;
                        
                        if (imagesGenerated === maxImages) {
                            break;
                        }
                    } catch (error) {
                        console.error(`Error generating image ${i + 1}:`, error);
                        ws.send(JSON.stringify({ role: 'ai', content: `Sorry, I encountered an error while generating image ${i + 1}!` }));
                    }
                }
            }
        } catch (error) {
            console.error('Error with API or file:', error);
            ws.send(JSON.stringify({ role: 'ai', content: 'Sorry, I encountered an error, bro!' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        conversationHistories.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        conversationHistories.delete(ws);
    });
});
