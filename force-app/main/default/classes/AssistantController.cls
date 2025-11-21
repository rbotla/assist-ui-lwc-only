public with sharing class AssistantController {

   private static AI_Agentic_Credentials__c credentials;

   static {
       Id sysAdminProfileId = [SELECT Id FROM Profile WHERE Name = 'System Administrator'].Id;
       credentials = AI_Agentic_Credentials__c.getInstance(sysAdminProfileId);
   }

   @AuraEnabled
   public static String getChatResponse(String message, String sessionId) {
       try {
           // Get OAuth token first
           String accessToken = getOAuthToken();
           if (String.isBlank(accessToken)) {
               throw new CalloutException('Failed to obtain OAuth token');
           }

           // Prepare the request body for v3chat/response API
           Map<String, Object> requestBody = new Map<String, Object>();

           // Encode the message in base64 as shown in your curl example
           String encodedMessage = EncodingUtil.base64Encode(Blob.valueOf(message));
           requestBody.put('message', encodedMessage);
           requestBody.put('conversation_id', sessionId);

           String payload = JSON.serialize(requestBody);

           // Make the HTTP request to your v3chat/response endpoint
           Http http = new Http();
           HttpRequest request = new HttpRequest();
           request.setEndpoint(credentials.Base_URL__c + credentials.Chat_Endpoint__c);
           request.setMethod('POST');
           request.setHeader('Content-Type', 'application/json');
           request.setHeader('X-Upstream-Env', 'Stage');
           request.setHeader('x-idp', 'default');
           request.setHeader('Authorization', 'Bearer ' + accessToken);
           request.setBody(payload);
           request.setTimeout(30000); // 30 second timeout

           HttpResponse response = http.send(request);

           if (response.getStatusCode() == 200) {
               // Parse the complex API response format
               String responseBody = response.getBody();

               // The response contains multiple JSON objects separated by spaces
               // We need to find the final message with type "string"
               String finalMessage = parseApiResponse(responseBody);

               return finalMessage;

           } else {
               String errorMsg = 'HTTP Error ' + response.getStatusCode() + ': ' + response.getStatus();
               throw new CalloutException(errorMsg);
           }

       } catch (Exception e) {
           // Return a user-friendly error message
           if (e instanceof CalloutException) {
               throw new AuraHandledException('Failed to get response from AI service: ' + e.getMessage());
           } else {
               throw new AuraHandledException('An unexpected error occurred while processing your request.');
           }
       }
   }

   // Get OAuth token using your OAuth endpoint
   private static String getOAuthToken() {
       try {
           if (credentials == null) {
               return null;
           }

           Http http = new Http();
           HttpRequest request = new HttpRequest();
           request.setEndpoint(credentials.Base_URL__c + credentials.OAuth_Token_Endpoint__c);
           request.setMethod('POST');
           request.setHeader('Content-Type', 'application/x-www-form-urlencoded');

           // Prepare OAuth request body
           String oauthBody = 'client_id=' + EncodingUtil.urlEncode(credentials.Client_ID__c, 'UTF-8') +
                             '&client_secret=' + EncodingUtil.urlEncode(credentials.Client_Secret__c, 'UTF-8') +
                             '&grant_type=client_credentials' +
                             '&scope=' + EncodingUtil.urlEncode(credentials.OAuth_Scope__c, 'UTF-8');

           request.setBody(oauthBody);
           request.setTimeout(10000); // 10 second timeout for OAuth

           HttpResponse response = http.send(request);

           if (response.getStatusCode() == 200) {
               Map<String, Object> tokenResponse = (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
               return (String) tokenResponse.get('access_token');
           } else {
               return null;
           }

       } catch (Exception e) {
           return null;
       }
   }

   @AuraEnabled
   public static void submitChatFeedback(String messageId, String feedback, String sessionId) {
       try {
           // Get OAuth token first
           String accessToken = getOAuthToken();
           if (String.isBlank(accessToken)) {
               return; // Don't break user experience for feedback failures
           }

           // Prepare feedback data for your v3chat/feedback endpoint
           Map<String, Object> feedbackData = new Map<String, Object>();
           feedbackData.put('conversation_id', sessionId);
           feedbackData.put('feedback', feedback);
           feedbackData.put('message_id', messageId);
           feedbackData.put('timestamp', DateTime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSSZ'));
           feedbackData.put('source', 'salesforce-assistant');

           String payload = JSON.serialize(feedbackData);

           // Make the HTTP request to your v3chat/feedback endpoint
           Http http = new Http();
           HttpRequest request = new HttpRequest();
           request.setEndpoint(credentials.Base_URL__c + credentials.Chat_Feedback_Endpoint__c);
           request.setMethod('POST');
           request.setHeader('Content-Type', 'application/json');
           request.setHeader('X-Upstream-Env', 'Stage');
           request.setHeader('x-idp', 'default');
           request.setHeader('Authorization', 'Bearer ' + accessToken);
           request.setBody(payload);
           request.setTimeout(10000); // 10 second timeout for feedback

           HttpResponse response = http.send(request);

           // Note: We don't throw exceptions here as feedback submission failure shouldn't break the user experience

       } catch (Exception e) {
           // Log the error but don't throw an exception to the UI
       }
   }

   // Parse the complex API response format
   private static String parseApiResponse(String responseBody) {
       if (String.isBlank(responseBody)) return '';

       try {
           // Match all {"content": {"type": "string", "message": "..."}} patterns
           Pattern p = Pattern.compile('\\{"content":\\s*\\{"type":\\s*"string"[^}]*"message":\\s*"([^"]*)"');
           Matcher m = p.matcher(responseBody);

           String result = '';
           while (m.find()) {
               result = m.group(1).replace('\\n', '\n').replace('\\/', '/');
           }

           return String.isNotBlank(result) ? result : 'No final answer found.';
       } catch (Exception e) {
           return responseBody;
       }
   }


   // Helper method to get user details (similar to your existing pattern)
   private static Map<String, Object> getUserDetails() {
       User loggedInUserDetails = [SELECT Id, FirstName, LastName, Email, EmployeeNumber, FederationIdentifier
                                  FROM User WHERE Id = :UserInfo.getUserId() LIMIT 1];

       Map<String, Object> userMap = new Map<String, Object>();
       userMap.put('userId', loggedInUserDetails.Id);
       userMap.put('firstName', loggedInUserDetails.FirstName);
       userMap.put('lastName', loggedInUserDetails.LastName);
       userMap.put('email', loggedInUserDetails.Email);
       userMap.put('employeeNumber', loggedInUserDetails.EmployeeNumber);
       userMap.put('federationIdentifier', loggedInUserDetails.FederationIdentifier);

       return userMap;
   }
}







