
/* assistantChat.js - Enterprise-Grade Native LWC Chat for Gen AI - Nov 2025 */
import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import getChatResponse from '@salesforce/apex/AssistantController.getChatResponse';
import submitChatFeedback from '@salesforce/apex/AssistantController.submitChatFeedback';
import getKnowledgeArticleIds from '@salesforce/apex/AssistantController.getKnowledgeArticleIds';

const TYPING_INDICATOR_ID = 'typing-bubble-999';

export default class AssistantChat extends NavigationMixin(LightningElement) {
   @api height = '600px';
   @api welcomeMessage = 'Hello! How can I help you today?';
   @api inputPlaceholder = 'Type your message...';

   @track messages = [];
   @track userInput = '';
   @track isLoading = false;

   sessionId = Date.now().toString();
   chatContainer = null; // Cached reference

   /* ============================================== LIFECYCLE ============================================== */
   connectedCallback() {
       // Component initialization
   }

   disconnectedCallback() {
       // Clean up event listeners
       const existingLinks = this.template.querySelectorAll('.knowledge-article-link');
       existingLinks.forEach(link => {
           link.removeEventListener('click', this.boundHandleKnowledgeArticleClick);
       });
   }

   renderedCallback() {
       // Cache the scrollable container once for performance + reliability
       if (!this.chatContainer) {
           this.chatContainer = this.template.querySelector('.slds-chat_list');
       }

       // Handle manual DOM manipulation for messages with article links
       this.setupManualDOMContent();

       // Add event listeners for knowledge article links
       this.setupKnowledgeArticleLinks();
   }

   setupManualDOMContent() {
       // Find all manual DOM containers and populate them
       const manualContainers = this.template.querySelectorAll('.message-with-links');
       console.log('Manual containers found:', manualContainers.length);

       manualContainers.forEach((container, index) => {
           const messageId = container.dataset.messageId;
           console.log(`Container ${index}: messageId=${messageId}, hasChildren=${container.hasChildNodes()}`);

           if (messageId && !container.hasChildNodes()) {
               // Find the corresponding message
               const message = this.messages.find(msg => String(msg.id) === String(messageId));
               console.log(`Found message for ${messageId}:`, message ? 'YES' : 'NO');

               if (message && message.content) {
                   console.log('Setting innerHTML:', message.content.substring(0, 200));
                   container.innerHTML = message.content;
                   console.log('Container after innerHTML:', container.innerHTML.substring(0, 200));
               }
           }
       });
   }

   setupKnowledgeArticleLinks() {
       // Remove existing listeners to prevent duplicates
       const existingLinks = this.template.querySelectorAll('.knowledge-article-link');
       existingLinks.forEach(link => {
           link.removeEventListener('click', this.boundHandleKnowledgeArticleClick);
       });

       // Bind the handler once and store reference
       if (!this.boundHandleKnowledgeArticleClick) {
           this.boundHandleKnowledgeArticleClick = this.handleKnowledgeArticleClick.bind(this);
       }

       // Add new listeners
       existingLinks.forEach(link => {
           link.addEventListener('click', this.boundHandleKnowledgeArticleClick);
       });
   }

   handleKnowledgeArticleClick(event) {
       event.preventDefault();
       const articleId = event.target.dataset.articleId;
       if (articleId) {
           this.openKnowledgeArticle(articleId);
       }
   }

   /* ============================================== COMPUTED ============================================== */
   get wrapperStyle() {
       return `height:${this.height};max-height:${this.height};`;
   }

   get hasMessages() {
       return this.messages.length > 1; // exclude system message
   }

   get showWelcome() {
       return this.messages.length === 1 && !this.isLoading;
   }

   get sendDisabled() {
       return !this.userInput?.trim() || this.isLoading;
   }

   /* ============================================== MESSAGE HANDLING ============================================== */
   async addMessage(content, role = 'user', isTyping = false) {
       // Remove previous typing indicator if exists
       if (isTyping) {
           this.messages = this.messages.filter(m => m.id !== TYPING_INDICATOR_ID);
       }

       const id = isTyping ? TYPING_INDICATOR_ID : Date.now() + Math.random();
       const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

       // Handle async renderMarkdown for assistant messages
       let processedContent;
       if (role === 'assistant') {
           processedContent = await this.renderMarkdown(content);
       } else {
           processedContent = this.escapeHtml(content);
       }

       // Check if the content has article references
       const hasArticleRefs = role === 'assistant' && this.hasArticleReferences(content);

       const newMessage = {
           id,
           content: processedContent,
           rawContent: content,
           role,
           isTyping,
           bubbleClass: role === 'user' ? 'bubble-user' : role === 'system' ? 'bubble-system' : 'bubble-ai',
           showActions: role === 'assistant' && !isTyping,
           feedbackGiven: null,
           showFeedbackInput: false,
           feedbackType: null,
           feedbackTypeText: '',
           feedbackComment: '',
           isSubmittingFeedback: false,
           feedbackPlaceholder: '',
           feedbackRows: 2,
           hasArticleLinks: hasArticleRefs
       };

       this.messages = [...this.messages, newMessage];

       // Critical: Wait for DOM to update, then scroll
       if (!isTyping) {
           Promise.resolve().then(() => this.scrollToBottom());
       }
   }

   addSystemMessage(content) {
       this.messages = [{
           id: 'system-0',
           content: this.escapeHtml(content),
           role: 'system'
       }];
   }

   escapeHtml(text) {
       if (!text) return '';
       const div = document.createElement('div');
       div.textContent = text;
       return div.innerHTML;
   }

   async renderMarkdown(text) {
       if (!text) return '';

       // First, apply basic markdown formatting
       let formattedText = text
           .replace(/&/g, '&amp;')
           .replace(/</g, '&lt;')
           .replace(/>/g, '&gt;')
           .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
           .replace(/\*(.*?)\*/g, '<em>$1</em>')
           .replace(/__(.*?)__/g, '<strong>$1</strong>')
           .replace(/_(.*?)_/g, '<em>$1</em>')
           .replace(/`(.*?)`/g, '<code class="slds-code_inline">$1</code>')
           .replace(/\n/g, '<br>');

       // Parse and replace article references with links
       formattedText = await this.parseArticleReferences(formattedText);

       return formattedText;
   }

   async parseArticleReferences(text) {
       // Extract all article numbers from various patterns
       const articleNumbers = this.extractArticleNumbers(text);
       console.log('Extracted article numbers:', articleNumbers);

       if (articleNumbers.length === 0) {
           console.log('No article numbers found');
           return text;
       }

       try {
           // Get Knowledge Article IDs from Apex
           const articleMap = await getKnowledgeArticleIds({ articleNumbers });
           console.log('Article map from Apex:', articleMap);

           // Replace article references with clickable links
           let updatedText = text;

           // Pattern 1: (Article 000005262)
           updatedText = updatedText.replace(/\(Article\s+(\d{9})\)/g, (match, articleNumber) => {
               const articleId = articleMap[articleNumber];
               if (articleId) {
                   return `(<a href="#" data-article-id="${articleId}" data-article-number="${articleNumber}" class="knowledge-article-link">Article ${articleNumber}</a>)`;
               }
               return match;
           });

           // Pattern 2: (Article Numbers: 000005262, 000005218)
           updatedText = updatedText.replace(/\(Article\s+Numbers:\s*([\d,\s]+)\)/g, (match, articleNumbers) => {
               console.log('Processing Article Numbers pattern:', match);
               const numbers = articleNumbers.split(',').map(n => n.trim());
               const links = numbers.map(num => {
                   const articleId = articleMap[num];
                   console.log(`Article ${num}: ID = ${articleId}`);
                   if (articleId && /^\d{9}$/.test(num)) {
                       return `<a href="#" data-article-id="${articleId}" data-article-number="${num}" class="knowledge-article-link">${num}</a>`;
                   }
                   return num; // Return plain number if no ID found
               });
               const result = `(Article Numbers: ${links.join(', ')})`;
               console.log('Replaced with:', result);
               return result;
           });

           // Pattern 3: (Article Number: 000006196)
           updatedText = updatedText.replace(/\(Article\s+Number:\s*(\d{9})\)/g, (match, articleNumber) => {
               console.log('Processing Article Number pattern:', match);
               const articleId = articleMap[articleNumber];
               console.log(`Article ${articleNumber}: ID = ${articleId}`);
               if (articleId) {
                   const result = `(Article Number: <a href="#" data-article-id="${articleId}" data-article-number="${articleNumber}" class="knowledge-article-link">${articleNumber}</a>)`;
                   console.log('Replaced with:', result);
                   return result;
               }
               return match; // Return original if no ID found
           });

           // Pattern 4: (Article 000005262, 000005263) - legacy support
           updatedText = updatedText.replace(/\(Article\s+([\d,\s]+)\)/g, (match, articleNumbers) => {
               // Skip if this looks like our new patterns
               if (match.includes('Number:') || match.includes('Numbers:')) {
                   return match; // Let other patterns handle this
               }
               const numbers = articleNumbers.split(',').map(n => n.trim());
               const links = numbers.map(num => {
                   const articleId = articleMap[num];
                   if (articleId) {
                       return `<a href="#" data-article-id="${articleId}" data-article-number="${num}" class="knowledge-article-link">${num}</a>`;
                   }
                   return num;
               });
               return `(Article ${links.join(', ')})`;
           });

           // Pattern 5: Article: 000005262
           updatedText = updatedText.replace(/Article:\s+(\d{9})/g, (match, articleNumber) => {
               const articleId = articleMap[articleNumber];
               if (articleId) {
                   return `Article: <a href="#" data-article-id="${articleId}" data-article-number="${articleNumber}" class="knowledge-article-link">${articleNumber}</a>`;
               }
               return match;
           });

           console.log('Final updatedText with links:', updatedText.substring(0, 500));
           return updatedText;

       } catch (error) {
           console.error('Error fetching article IDs:', error);
           return text; // Return original text if error occurs
       }
   }

   extractArticleNumbers(text) {
       const numbers = new Set();

       // Pattern 1: (Article 000005262)
       const pattern1 = /\(Article\s+(\d{9})\)/g;
       let match;
       while ((match = pattern1.exec(text)) !== null) {
           numbers.add(match[1]);
       }

       // Pattern 2: (Article 000005262, 000005263) - legacy support
       const pattern2 = /\(Article\s+([\d,\s]+)\)/g;
       while ((match = pattern2.exec(text)) !== null) {
           const articleNumbers = match[1].split(',').map(n => n.trim());
           articleNumbers.forEach(num => {
               if (/^\d{9}$/.test(num)) {
                   numbers.add(num);
               }
           });
       }

       // Pattern 3: Article: 000005262
       const pattern3 = /Article:\s+(\d{9})/g;
       while ((match = pattern3.exec(text)) !== null) {
           numbers.add(match[1]);
       }

       // Pattern 4: (Article Numbers: 000005262, 000005218)
       const pattern4 = /\(Article\s+Numbers:\s*([\d,\s]+)\)/g;
       while ((match = pattern4.exec(text)) !== null) {
           const articleNumbers = match[1].split(',').map(n => n.trim());
           articleNumbers.forEach(num => {
               if (/^\d{9}$/.test(num)) {
                   numbers.add(num);
               }
           });
       }

       // Pattern 5: (Article Number: 000006196)
       const pattern5 = /\(Article\s+Number:\s*(\d{9})\)/g;
       while ((match = pattern5.exec(text)) !== null) {
           numbers.add(match[1]);
       }

       return Array.from(numbers);
   }

   hasArticleReferences(text) {
       if (!text) return false;
       // Updated patterns to match actual formats:
       // (Article Numbers: 000005262, 000005218)
       // (Article Number: 000006196)
       // (Article 000005262)
       // Article: 000005262
       const hasRefs = /(\(Article\s+Numbers?:\s*[\d,\s]+\))|(\(Article\s+\d{9}\))|(Article:\s+\d{9})/g.test(text);
       console.log('hasArticleReferences check:', text.substring(0, 200), '...', 'hasRefs:', hasRefs);
       return hasRefs;
   }

   /* ============================================== USER INPUT ============================================== */
   handleInput(event) {
       this.userInput = event.target.value;
   }

   handleKeyDown(event) {
       if (event.key === 'Enter' && !event.shiftKey) {
           event.preventDefault();
           this.handleSend();
       }
   }

   async handleSend() {
       if (this.sendDisabled) return;

       const userMessage = this.userInput.trim();
       if (!userMessage) return;

       this.userInput = '';  // ← This instantly clears the box
       this.addMessage(userMessage, 'user');
       this.addMessage('', 'assistant', true);
       this.isLoading = true;

       try {
           const response = await getChatResponse({
               message: userMessage,
               sessionId: this.sessionId
           });

           // Remove typing bubble
           this.messages = this.messages.filter(m => m.id !== TYPING_INDICATOR_ID);
           this.addMessage(response, 'assistant');

       } catch (error) {
           this.messages = this.messages.filter(m => m.id !== TYPING_INDICATOR_ID);
           this.addMessage('Sorry, I encountered an error. Please try again later.', 'assistant');
           this.showToast('Error', error.body?.message || 'Failed to reach AI service', 'error');
           console.error('Chat error:', error);
       } finally {
           this.isLoading = false;
       }
   }

   /* ============================================== ACTIONS ============================================== */

   handleFeedback(event) {
       const msgId = event.currentTarget.dataset.id;
       const feedback = event.currentTarget.dataset.feedback; // 'positive' or 'negative'

       // Configure feedback experience based on type
       const isNegative = feedback === 'negative';
       const feedbackConfig = {
           showFeedbackInput: true,
           feedbackType: feedback,
           feedbackTypeText: isNegative ? '👎 Help us improve' : '👍 Positive feedback',
           feedbackComment: '',
           feedbackRows: isNegative ? 4 : 2,
           feedbackPlaceholder: isNegative
               ? 'Please be specific: What was incorrect? What should the correct answer be? Include article numbers or references if possible...'
               : 'Tell us what you liked about this response (optional)...'
       };

       // Show feedback input inside the specific message bubble
       this.messages = this.messages.map(msg => {
           if (msg.id == msgId) {
               return { ...msg, ...feedbackConfig };
           }
           return msg;
       });

       // Auto-focus the feedback input
       Promise.resolve().then(() => {
           const textarea = this.template.querySelector(`textarea[data-id="${msgId}"]`);
           if (textarea) {
               textarea.focus();
           }
       });
   }

   handleBubbleFeedbackInput(event) {
       const msgId = event.currentTarget.dataset.id;
       const comment = event.target.value;

       this.messages = this.messages.map(msg => {
           if (msg.id == msgId) {
               return { ...msg, feedbackComment: comment };
           }
           return msg;
       });
   }

   handleBubbleFeedbackKeyDown(event) {
       if (event.key === 'Enter') {
           event.preventDefault();
           this.submitBubbleFeedback(event);
       }
   }

   cancelBubbleFeedback(event) {
       const msgId = event.currentTarget.dataset.id;

       this.messages = this.messages.map(msg => {
           if (msg.id == msgId) {
               return {
                   ...msg,
                   showFeedbackInput: false,
                   feedbackType: null,
                   feedbackTypeText: '',
                   feedbackComment: '',
                   feedbackPlaceholder: '',
                   feedbackRows: 2
               };
           }
           return msg;
       });
   }

   async submitBubbleFeedback(event) {
       const msgId = event.currentTarget.dataset.id;
       const msg = this.messages.find(m => m.id == msgId);

       if (!msg || !msg.feedbackType) return;

       // Set submitting state
       this.messages = this.messages.map(m => {
           if (m.id == msgId) {
               return { ...m, isSubmittingFeedback: true };
           }
           return m;
       });

       try {
           const result = await submitChatFeedback({
               messageId: msgId,
               userFeedback: msg.feedbackType,
               sessionId: this.sessionId,
               comment: msg.feedbackComment || ''
           });

           if (result.success) {
               // Hide feedback input and show feedback was given
               this.messages = this.messages.map(m => {
                   if (m.id == msgId) {
                       return {
                           ...m,
                           showFeedbackInput: false,
                           feedbackGiven: 'brand',
                           isSubmittingFeedback: false,
                           feedbackComment: '',
                           feedbackType: null,
                           feedbackTypeText: '',
                           feedbackPlaceholder: '',
                           feedbackRows: 2
                       };
                   }
                   return m;
               });

               // Add system message based on backend response
               if (result.status === 'ok') {
                   const feedbackText = result.user_feedback === 'positive' ? '👍 positive' : '👎 negative';
                   const commentText = result.comment ? ` (${result.comment})` : '';
                   this.addMessage(`✅ Feedback received: ${feedbackText}${commentText}`, 'system');
               } else {
                   this.addMessage(`❌ Feedback failed: ${result.user_feedback}`, 'system');
               }

               this.showToast('Thank you', 'Feedback submitted successfully', 'success');
           } else {
               this.addMessage(`❌ Error sending feedback: ${result.message}`, 'system');
               this.showToast('Error', result.message || 'Could not submit feedback', 'error');
           }

       } catch (err) {
           this.addMessage(`❌ Error sending feedback: ${err.body?.message || err.message}`, 'system');
           this.showToast('Error', 'Could not submit feedback', 'error');
       } finally {
           // Reset submitting state and clear all feedback fields
           this.messages = this.messages.map(m => {
               if (m.id == msgId) {
                   return {
                       ...m,
                       isSubmittingFeedback: false,
                       showFeedbackInput: false,
                       feedbackComment: '',
                       feedbackType: null,
                       feedbackTypeText: '',
                       feedbackPlaceholder: '',
                       feedbackRows: 2
                   };
               }
               return m;
           });
       }
   }

   handleClear() {
       if (confirm('Clear conversation history?')) {
           this.messages = [];
           this.addSystemMessage('Conversation cleared.');
           this.sessionId = Date.now().toString();
       }
   }

   /* ============================================== SCROLLING (100% WORKING) ============================================== */
   scrollToBottom() {
       // This is the ONLY method that works reliably in all Salesforce orgs (2024–2025)
       Promise.resolve().then(() => {
           const container = this.chatContainer || this.template.querySelector('.slds-chat_list');
           if (container) {
               container.scrollTop = container.scrollHeight + 9999; // +9999 forces bottom even with images/momentum
           }
       });
   }

   /* ============================================== KNOWLEDGE ARTICLE NAVIGATION ============================================== */
   openKnowledgeArticle(articleId) {
       this[NavigationMixin.Navigate]({
           type: 'standard__knowledgeArticlePage',
           attributes: {
               articleId: articleId,
               urlName: null
           }
       });
   }

   /* ============================================== UTILITIES ============================================== */
   showToast(title, message, variant = 'info') {
       this.dispatchEvent(new ShowToastEvent({
           title,
           message,
           variant
       }));
   }
}