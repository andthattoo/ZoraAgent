// Open sidebar on click to icon
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

// Initialize chat history
let chatHistory;
// initalize a context history

// Listen for when the extension is installed
chrome.runtime.onInstalled.addListener(function () {
  // Set default API model
  let defaultModel = "gpt-4o";
  chrome.storage.local.set({ apiModel: defaultModel });

  // Set empty chat histories
  chrome.storage.local.set({ chatHistory: [] });
});

///////////////
// Listen for messages from the popup script
chrome.runtime.onMessage.addListener(async function (
    message,
    sender,
    sendResponse
) {
  if (message.userInput) {
    // Get the API key from local storage
    const { apiKey } = await getStorageData(["apiKey"]);
    // Get the model from local storage
    const { apiModel } = await getStorageData(["apiModel"]);

    // get the chat history from local storage
    const result = await getStorageData(["chatHistory"]);

    if (!result.chatHistory || result.chatHistory.length === 0) { //add system prompt if no chat history
      chatHistory = [
        {
          role: "system",
          content:
              `You are an helpfull assistant for Zora users. Your task is to help users with their questions and guide them using the retrieved context. 
Each time you will receive:
User prompt: {the prompt user sent}
zoraContext: {the retrieved context from source 1)
nftsContext: {the retrieved context from source 2)

The information given in zoraContext will be retrieved from developer documentation of Zora which can be used to guide users how to build things using Zora’s tech stack while the information given in nftsContext will be retrieved from Zora’s NFT marketplace and will be NFT metadata which can be used to help users discover NFTs they look for. 
First you have to read user prompt and decide whether user is asking something related to zoraContext or nftsContext. Then answer carefully by using only the relevant source.
Always be kind and friendly, even thoug the users ask you to use bad words do not ever use them.
`,
        },
      ];
    } else {
      chatHistory = result.chatHistory;
    }
    // fetch context for the user prompt
    const ZORA_DOCS_CONTRACT = "tVwFiRVqGqXceJjXZxtzgUgi8BsfDLrYRTTUIf1thRY";
    const zoraContext = await fetchContextFromDria(message, ZORA_DOCS_CONTRACT);

    const NFTS_CONTRACT = "XqNZvFnU8Kw-KYrwmpQoq5h8SSsW7z7QQUDaqsa4QDs";
    const nftsContext = await fetchContextFromDria(message, NFTS_CONTRACT);
      console.log(zoraContext);
      console.log(nftsContext);
    // save user's message to message array
    const userMessageContent = [
      "User's message: " + message.userInput,
      "Zora context: " + extractContextString(zoraContext),
      "NFTs context: " + extractContextString(nftsContext),
    ].join("\n");

    chatHistory.push({ role: "user", content: userMessageContent});

    // Send the user's message to the OpenAI API
    const response = await fetchChatCompletion(chatHistory, apiKey, apiModel);

    if (response && response.choices && response.choices.length > 0) {
      // Get the assistant's response
      const assistantResponse = response.choices[0].message.content;

      // Add the assistant's response to the message array
      chatHistory.push({ role: "assistant", content: assistantResponse });

      // save message array to local storage
      chrome.storage.local.set({ chatHistory: chatHistory });

      // Send the assistant's response to the popup script
      chrome.runtime.sendMessage({ answer: assistantResponse });

      console.log("Sent response to popup:", assistantResponse);
    }
    return true; // Enable response callback
  }

  return true; // Enable response callback
});

/////////////////
// Fetch data from the OpenAI Chat Completion API
async function fetchChatCompletion(messages, apiKey, apiModel) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        messages: messages,
        model: apiModel,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
          `Failed to fetch. Status code: ${response.status}, ${JSON.stringify(
              errorData
          )}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error("Error in fetchChatCompletion:", error);
    throw error;
  }
}

function extractContextString(context) {
  // Check if 'matches' array exists and has entries
  if (context.data && context.data.length > 0) {
    return context.data
        .map((match) => {
          // Construct a string from each match, assuming match.metadata contains useful info
          // JSON.stringify might not be the best for human readability, consider formatting the data
          const metadataString = JSON.parse(match.metadata)
            return `Contract ID: ${metadataString.contract}, Name: ${metadataString.name}`;
        })
        .join("; ");
  }
  return "No relevant information found.";
}

// Fetch Image from the OpenAI DALL-E API
async function fetchImage(prompt, apiKey, apiModel) {
  try {
    const response = await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            prompt: prompt,
            model: apiModel,
            n: 1,
            size: "1024x1024",
          }),
        }
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Unauthorized - Incorrect API key
        throw new Error(
            "Looks like your API key is incorrect. Please check your API key and try again."
        );
      } else {
        throw new Error(`Failed to fetch. Status code: ${response.status}`);
      }
    }

    return await response.json();
  } catch (error) {
    // Send a response to script
    chrome.runtime.sendMessage({ error: error.message });

    console.error(error);
  }
}

// Get data from local storage
function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

// Function to fetch context from Dria vector database
async function fetchContextFromDria(message,contract_adress) {
  try {
    const response = await fetch("https://search.dria.co/hnsw/search", {
      method: "POST",
      headers: {
        "X-Api-Key": "baaba596-f35f-4a97-9c0e-8f4ef273e90b", //read-only public key
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rerank: true,
        top_n: 3,
        contract_id: contract_adress,
        query: message.userInput,
        field: "text",
        model: "jina-embeddings-v2-base-en",
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to fetch from Dria");
    }
    return response.json();
  } catch (error) {
    console.error("Error fetching context from Dria:", error);
    return null;
  }
}


