
/* assistantChat.js - Enterprise-Grade Native LWC Chat for Gen AI - Nov 2025 */
import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getChatResponse from '@salesforce/apex/AssistantController.getChatResponse';
import submitChatFeedback from '@salesforce/apex/AssistantController.submitChatFeedback';

const TYPING_INDICATOR_ID = 'typing-bubble-999';

export default class AssistantChat extends LightningElement {
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
       // this.addSystemMessage('You are a helpful AI assistant for Salesforce users.');
   }

   renderedCallback() {
       // Cache the scrollable container once for performance + reliability
       if (!this.chatContainer) {
           this.chatContainer = this.template.querySelector('.slds-chat_list');
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
   addMessage(content, role = 'user', isTyping = false) {
       // Remove previous typing indicator if exists
       if (isTyping) {
           this.messages = this.messages.filter(m => m.id !== TYPING_INDICATOR_ID);
       }

       const id = isTyping ? TYPING_INDICATOR_ID : Date.now() + Math.random();
       const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

       const newMessage = {
           id,
           content: role === 'assistant' ? this.renderMarkdown(content) : this.escapeHtml(content),
           rawContent: content,
           role,
           isTyping,
           bubbleClass: role === 'user' ? 'bubble-user' : 'bubble-ai',
           showActions: role === 'assistant' && !isTyping
       };
       // const newMessage = {
       //     id,
       //     content: role === 'assistant' ? this.renderMarkdown(content) : this.escapeHtml(content),
       //     rawContent: content, // for copying
       //     role,
       //     timestamp,
       //     isTyping,
       //     align: role === 'user' ? 'outgoing' : 'incoming',
       //     avatarClass: role === 'user'
       //         ? 'slds-avatar slds-avatar_circle slds-chat-avatar_user'
       //         : 'slds-avatar slds-avatar_circle slds-chat-avatar_agent',
       //     icon: role === 'user' ? 'utility:user' : 'utility:bot',
       //     itemClass: `slds-chat_message slds-chat_message_${role === 'user' ? 'outgoing' : 'incoming'}`,
       //     showActions: role === 'assistant' && !isTyping
       // };

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

   renderMarkdown(text) {
       if (!text) return '';
       return text
           .replace(/&/g, '&amp;')
           .replace(/</g, '&lt;')
           .replace(/>/g, '&gt;')
           .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
           .replace(/\*(.*?)\*/g, '<em>$1</em>')
           .replace(/__(.*?)__/g, '<strong>$1</strong>')
           .replace(/_(.*?)_/g, '<em>$1</em>')
           .replace(/`(.*?)`/g, '<code class="slds-code_inline">$1</code>')
           .replace(/\n/g, '<br>');
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
   handleCopy(event) {
       const msgId = event.currentTarget.dataset.id;
       const msg = this.messages.find(m => m.id == msgId);
       if (msg?.rawContent) {
           navigator.clipboard.writeText(msg.rawContent);
           this.showToast('Copied!', 'Message copied to clipboard', 'success');
       }
   }

   async handleFeedback(event) {
       const msgId = event.currentTarget.dataset.id;
       const feedback = event.currentTarget.dataset.feedback; // 'positive' or 'negative'

       try {
           await submitChatFeedback({
               messageId: msgId,
               feedback,
               sessionId: this.sessionId
           });
           this.showToast('Thank you', 'Feedback recorded', 'success');
       } catch (err) {
           this.showToast('Error', 'Could not submit feedback', 'error');
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

   /* ============================================== UTILITIES ============================================== */
   showToast(title, message, variant = 'info') {
       this.dispatchEvent(new ShowToastEvent({
           title,
           message,
           variant
       }));
   }
}