# Outlook Add-in

Independent Office.js add-in implementation. The compose event will use a cached published template, request the current user's approved Graph profile fields in memory, and set the compose signature. It will not call the template API from the compose handler or persist rendered profile data.

The add-in task pane will provide the end-user template picker. Microsoft sample code is a reference only; this project will not fork that sample.