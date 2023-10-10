<script setup>
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import hljs from "highlight.js";
import { storeToRefs } from "pinia";
import GPTIcon from "~/components/Icons/GPTIcon.vue";
import ClientDropdown from "~/components/Chat/ClientDropdown.vue";
import ClientSettings from "~/components/Chat/ClientSettings.vue";
import { reactive } from "vue";

marked.setOptions({
  silent: true,
  xhtml: true,
  breaks: true,
  gfm: true,
});
const renderer = {
  code(code, lang) {
    let language = "plaintext";
    let highlightedCode;
    try {
      highlightedCode = hljs.highlightAuto(code).value;
    } catch {
      language = hljs.getLanguage(lang) ? lang : "plaintext";
      highlightedCode = hljs.highlight(code, { language }).value;
    }
    const copyButton = `
<button
    class="absolute right-0 top-0 pt-1 pr-2 font-sans whitespace-normal flex items-center gap-1"
    data-is-copy-button="true"
>
    <svg
        class="w-3 h-3 relative top-px"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
    >
        <path d="M20 2H10c-1.103 0-2 .897-2 2v4H4c-1.103 0-2 .897-2 2v10c0 1.103.897 2 2 2h10c1.103 0 2-.897 2-2v-4h4c1.103 0 2-.897 2-2V4c0-1.103-.897-2-2-2zM4 20V10h10l.002 10H4zm16-6h-4v-4c0-1.103-.897-2-2-2h-4V4h10v10z"></path>
    </svg>
    <span class="copy-status">Copy</span>
</button>`.trim();
    return `<pre class="p-0 relative">${copyButton}<code class="hljs${
      language ? ` language-${language}` : ""
    }">${highlightedCode}</code></pre>`;
  },
};
marked.use({ renderer });
const renderingState = reactive({
  streaming: false,
  someText: "",
});
const config = useRuntimeConfig();

const presetsStore = usePresetsStore();
const { activePresetName, activePreset } = storeToRefs(presetsStore);
const { setActivePresetName } = presetsStore;

const conversationsStore = useConversationsStore();

const {
  newConversationCounter,
  currentConversation,
  selectedConversation,
  currentConversationV2,
  currentConversationIdV2,
  conversationsV2,
  processingController,
} = storeToRefs(conversationsStore);

// console.log("newConversationCounter", newConversationCounter);
const { updateConversation, saveConversation, saveConversationHistory } =
  conversationsStore;

const DEFAULT_SYSTEM_PROMPT =
  "The following is a friendly conversation between a human and an AI. The AI is talkative and provides lots of specific details from its context. If the AI does not know the answer to a question, it truthfully says it does not know.";

const isClientDropdownOpen = ref(false);
const isClientSettingsModalOpen = ref(false);
const clientSettingsModalClient = ref(null);
const clientSettingsModalPresetName = ref(null);

const messagesContainerElement = ref(null);
const inputContainerElement = ref(null);
const inputTextElement = ref(null);
const chatButtonsContainerElement = ref(null);

const activePresetNameToUse = computed(
  () => currentConversation.value?.activePresetName || activePresetName.value
);
const activePresetToUse = computed(
  () => currentConversation.value?.activePreset || activePreset.value
);
const conversationData = ref(currentConversation.value?.data || {});
// const messages = ref(currentConversationV2.value?.messages || []);
// console.log("conversationsV2", conversationsV2);
const messages = computed(() => currentConversationV2.value?.messages || []);
const message = ref("");
const suggestedResponses = ref([]);
const regenerateData = computed(() => {
  if (!messages.value.length) {
    return {};
  }
  // find last index message where role = user
  const lastUserMessageIndex = messages.value
    .map((_message) => _message.role)
    .lastIndexOf("user");
  if (lastUserMessageIndex === -1) {
    // this should never happen
    return {};
  }
  const lastUserMessage = messages.value[lastUserMessageIndex];
  const lastBotMessage = messages.value[lastUserMessageIndex + 1];
  return {
    input: lastUserMessage.text,
    parentMessageId: lastUserMessage.parentMessageId || false,
    userMessageIndex: lastUserMessageIndex,
    botMessageIndex: lastUserMessageIndex + 1,
    canRegenerate:
      typeof lastBotMessage?.parentMessageId !== "undefined" &&
      lastBotMessage?.parentMessageId !== null,
  };
});

const canChangePreset = computed(
  () =>
    !processingController.value &&
    Object.keys(conversationData.value).length === 0
);

// compute number of rows for textarea based on message newlines, up to 7
const inputRows = computed(() => {
  const newlines = (message.value.match(/\n/g) || []).length;
  return Math.min(newlines + 1, 7);
});

const scrollToBottom = () => {
  messagesContainerElement.value.scrollTop =
    messagesContainerElement.value.scrollHeight;
};

const stopProcessing = () => {
  if (!processingController.value) {
    return;
  }
  processingController.value.abort();
  processingController.value = null;
};

const setChatContainerHeight = () => {
  const headerElementHeight = document.querySelector("header").offsetHeight;
  const footerElementHeight = document.querySelector("footer").offsetHeight;
  const inputContainerElementHeight = inputContainerElement.value.offsetHeight;
  const chatButtonsContainerElementHeight =
    chatButtonsContainerElement.value.offsetHeight;
  const heightOffset =
    window.document.documentElement.clientHeight - window.innerHeight;
  const containerHeight =
    window.document.documentElement.clientHeight -
    (headerElementHeight + footerElementHeight) -
    inputContainerElementHeight -
    heightOffset -
    chatButtonsContainerElementHeight -
    50;
  // set container height
  messagesContainerElement.value.style.height = `${containerHeight}px`;
  // move input container element bottom down
  inputContainerElement.value.style.bottom = `${heightOffset}px`;
  scrollToBottom();
};

const sendMessageToTrainedQa = async (input, parentMessageId = null) => {
  let updatedConversation;
  input = input.trim();
  if (!input) {
    return;
  }

  isClientDropdownOpen.value = false;
  suggestedResponses.value = [];
  processingController.value = new AbortController();

  const userMessage = {
    content: input,
    role: "user",
  };

  messages.value.push(userMessage);
  //   console.log(selectedConversation.value);
  if (
    selectedConversation.value &&
    selectedConversation.value.messages &&
    selectedConversation.value.messages > 0
  ) {
    if (selectedConversation && selectedConversation.value.messages) {
      updatedConversation.value.messages.push(messages);
    }
    saveConversation(updatedConversation);
    currentConversationIdV2.value = updatedConversation;
  } else {
    const lastConversation = conversationsV2.value.length;
    const newConversation = {
      id: lastConversation || 1,
      name: input,
      messages: messages.value,
      prompt: DEFAULT_SYSTEM_PROMPT,
      index: {
        indexName: "",
        indexType: "",
      },
      uuid: new Date().toString(),
    };
    // console.log("conversationsV2.value", conversationsV2.value);
    saveConversation(newConversation);
    updatedConversation = newConversation;
    currentConversationIdV2.value = newConversation;
    const updatedConversations = [...conversationsV2.value, newConversation];
    saveConversationHistory(updatedConversations);
  }
  //   console.log(selectedConversation.value);
  await nextTick();
  scrollToBottom();

  let result;
  let stream = true;

  const data = {
    ...conversationData.value,
    message: input,
    stream,
  };

  const opts = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  };

  let response = await fetch(`${config.public.apiBaseUrl}/chatgpt/query`, {
    ...opts,
    signal: processingController.value.signal,
  });

  if (!response.ok) {
    console.log("chat failed: ", input);
  }

  if (!response?.body) {
    console.log("response?.body: ", input);
    return;
  }

  if (updatedConversation.messages.length === 1) {
    const { content } = userMessage;
    const customName =
      content.length > 30 ? content.substring(0, 30) + "..." : content;

    updatedConversation = {
      ...updatedConversation,
      name: customName,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let isFirst = true;
  let text = "";

  while (!done) {
    const { value, done: doneReading } = await reader.read();
    done = doneReading;
    // console.log("done", done);
    const chunkValue = decoder.decode(value);
    text += chunkValue;

    renderingState.someText = parseMarkdown(text, true);
    renderingState.streaming = true;
    if (isFirst) {
      isFirst = false;
      const updatedMessages = [
        ...updatedConversation.messages,
        { role: "bot", content: chunkValue },
      ];

      updatedConversation = {
        ...updatedConversation,
        messages: updatedMessages,
      };
    } else {
      const updatedMessages = updatedConversation.messages.map(
        (message, index) => {
          if (index === updatedConversation.messages.length - 1) {
            return {
              ...message,
              content: text,
            };
          }

          return message;
        }
      );

      updatedConversation = {
        ...updatedConversation,
        messages: updatedMessages,
      };
    }

    // console.log("currentConversationV2", currentConversationV2.value);
    message.value = "";

    saveConversation(updatedConversation);
    currentConversationIdV2.value = updatedConversation;

    await nextTick();
    scrollToBottom();
  }

  await reader.cancel();
  const selectedConversationParsed = JSON.parse(selectedConversation.value);
  //   console.log("selectedConversation.value", selectedConversationParsed.id);

  const updatedConversations = conversationsV2.value.map((conversation) => {
    if (conversation.id === selectedConversationParsed.id) {
      return updatedConversation;
    }

    return conversation;
  });

  if (updatedConversations.length === 0) {
    updatedConversations.push(updatedConversation);
  }

  saveConversationHistory(updatedConversations);
  // updateConversation(updatedConversation);

  nextTick().then(() => {
    setChatContainerHeight();
    inputTextElement.value.focus();
  });
  processingController.value.abort();
  processingController.value = null;
  //   console.log(text);
};

const sendMessage = async (input, parentMessageId = null) => {
  if (processingController.value) {
    return;
  }

  input = input.trim();
  if (!input) {
    return;
  }

  if (parentMessageId !== null) {
    messages.value = getMessagesForConversation(
      messages.value,
      parentMessageId
    );
    if (parentMessageId === false) {
      delete conversationData.value.parentMessageId;
    } else {
      conversationData.value.parentMessageId = parentMessageId;
    }
  }

  isClientDropdownOpen.value = false;
  suggestedResponses.value = [];
  processingController.value = new AbortController();
  message.value = "";

  // remove id === 'new' and id === 'bot-new' messages
  messages.value = messages.value.filter(
    (_message) => !["new", "bot-new"].includes(_message.id)
  );

  const userMessage = {
    id: "new",
    parentMessageId: conversationData.value?.parentMessageId || false,
    text: input,
    role: "user",
  };
  messages.value.push(userMessage);
  const userMessageIndex = messages.value.length - 1;

  const botMessage = {
    id: "bot-new",
    parentMessageId: "new",
    text: "",
    role: "bot",
  };
  messages.value.push(botMessage);
  const botMessageIndex = messages.value.length - 1;

  await nextTick();
  scrollToBottom();

  let clientOptions;
  if (activePresetToUse.value?.options.clientOptions) {
    clientOptions = {
      ...activePresetToUse.value?.options.clientOptions,
      clientToUse: activePresetToUse.value?.client,
    };
  } else {
    clientOptions = {
      clientToUse:
        activePresetToUse.value?.client || activePresetNameToUse.value,
    };
  }

  let stream = true;
  if (typeof activePresetToUse.value?.options?.stream !== "undefined") {
    stream = activePresetToUse.value?.options?.stream;
  }

  const data = {
    ...conversationData.value,
    message: input,
    stream,
    clientOptions,
  };

  if (
    typeof activePresetToUse.value?.options?.shouldGenerateTitle === "undefined"
  ) {
    data.shouldGenerateTitle = true;
  } else {
    data.shouldGenerateTitle =
      activePresetToUse.value?.options?.shouldGenerateTitle;
  }

  const opts = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  };

  const handleMessageResult = (result) => {
    console.debug(result);
    messages.value[userMessageIndex].id = result.parentMessageId;
    messages.value[botMessageIndex].id = result.messageId;
    messages.value[botMessageIndex].parentMessageId = result.parentMessageId;
    let conversationId;
    if (result.conversationSignature) {
      conversationId = result.conversationId;
      conversationData.value = {
        conversationId: result.conversationId,
        conversationSignature: result.conversationSignature,
        clientId: result.clientId,
        invocationId: result.invocationId,
        parentMessageId: null,
      };
    } else {
      // other clients
      conversationId = result.conversationId;
      conversationData.value = {
        conversationId: result.conversationId,
        parentMessageId: result.messageId,
        title: result.title,
      };
    }
    const adaptiveText =
      result.details.adaptiveCards?.[0]?.body?.[0]?.text?.trim();
    if (adaptiveText) {
      console.debug("adaptiveText", adaptiveText);
      messages.value[botMessageIndex].text = adaptiveText;
    } else {
      messages.value[botMessageIndex].text = result.response;
    }
    messages.value[botMessageIndex].raw = result;
    if (result.details.suggestedResponses) {
      suggestedResponses.value = result.details.suggestedResponses.map(
        (response) => response.text
      );
    }
    updateConversation(
      conversationId,
      conversationData.value,
      messages.value,
      activePresetNameToUse.value,
      activePresetToUse.value
    );
    nextTick().then(() => {
      setChatContainerHeight();
      inputTextElement.value.focus();
    });
  };

  if (!stream) {
    const result = await fetch(
      `${config.public.apiBaseUrl}/chatgpt/sendMessage`,
      {
        ...opts,
        signal: processingController.value.signal,
      }
    );
    processingController.value = null;

    if (result.status === 200) {
      const json = await result.json();

      handleMessageResult(json.data);
    } else {
      let errorData = await result.text();

      messages.value[botMessageIndex].error = true;
      messages.value[botMessageIndex].raw = errorData;
      try {
        errorData = JSON.parse(errorData);
        messages.value[botMessageIndex].text =
          errorData.error || "An error occurred. Please try again.";
      } catch {
        messages.value[botMessageIndex].text = `\`\`\`\n${errorData
          .toString()
          .trim()}\n\`\`\``;
      }
    }
    return;
  }

  try {
    await fetchEventSource(`${config.public.apiBaseUrl}/chatgpt/sendMessage`, {
      ...opts,
      openWhenHidden: true,
      signal: processingController.value.signal,
      onopen(response) {
        if (response.status === 200) {
          return;
        }
        throw new Error(
          `Failed to send message. HTTP ${response.status} - ${response.statusText}`
        );
      },
      onclose() {
        throw new Error(
          "Failed to send message. Server closed the connection unexpectedly."
        );
      },
      onerror(err) {
        throw err;
      },
      onmessage(eventMessage) {
        if (eventMessage.data === "[DONE]") {
          processingController.value.abort();
          return;
        }
        if (eventMessage.event === "result") {
          const result = JSON.parse(eventMessage.data);
          handleMessageResult(result);
          return;
        }
        if (eventMessage.event === "error") {
          const eventMessageData = JSON.parse(eventMessage.data);
          messages.value[botMessageIndex].text = eventMessageData.error
            ? `\`\`\`\n${eventMessageData.error.toString().trim()}\n\`\`\``
            : "An error occurred. Please try again.";
          messages.value[botMessageIndex].error = true;
          messages.value[botMessageIndex].raw = eventMessageData;
          nextTick().then(() => setChatContainerHeight());
          return;
        }
        messages.value[botMessageIndex].text += JSON.parse(eventMessage.data);
        nextTick().then(() => scrollToBottom());
      },
    });
  } catch (err) {
    console.error("ERROR", err);
  } finally {
    if (!processingController.value?.signal.aborted) {
      processingController.value.abort();
    }
    processingController.value = null;
    await nextTick();
    inputTextElement.value.focus();
  }
};

const parseMarkdown = (text, streaming = false) => {
  text = text.trim();
  let cursorAdded = false;
  // workaround for incomplete code, closing the block if it's not closed
  // First, count occurrences of "```" in the text
  const codeBlockCount = (text.match(/```/g) || []).length;
  const shouldAddClosingBlock =
    codeBlockCount % 2 === 1 && !text.endsWith("```");
  // If the count is odd and the text doesn't end with "```", add a closing block
  if (shouldAddClosingBlock) {
    if (streaming) {
      text += "█\n```";
      cursorAdded = true;
    } else {
      text += "\n```";
    }
  }
  if (codeBlockCount && !shouldAddClosingBlock) {
    // make sure the last "```" is on a newline
    text = text.replace(/```$/, "\n```");
  }
  if (streaming && !cursorAdded) {
    text += "█";
  }

  try {
    // convert to markdown
    let parsed = marked.parse(text);
    // 1. replace "[^1^]" with "[1]" (during progress streams)
    parsed = parsed.replace(/\[\^(\d+)\^]/g, "<strong>[$1]</strong>");
    // 2. replace "^1^" with "[1]" (after the progress stream is done)
    parsed = parsed.replace(/\^(\d+)\^/g, "<strong>[$1]</strong>");

    return DOMPurify.sanitize(parsed, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: [
        "allow",
        "allowfullscreen",
        "frameborder",
        "scrolling",
        "srcdoc",
      ],
    });
  } catch (err) {
    console.error("ERROR", err);
    return text;
  }
};

const setIsClientSettingsModalOpen = (
  isOpen,
  client = null,
  presetName = null
) => {
  isClientSettingsModalOpen.value = isOpen;
  clientSettingsModalClient.value = client;
  clientSettingsModalPresetName.value = presetName || client;
};

function getMessagesForConversation(
  conversationMessages,
  parentMessageId,
  conversationOrderedMessages = []
) {
  // Check if parent message id is valid
  if (parentMessageId) {
    // Find the message object that matches parent message id asynchronously
    const conversationMessage = conversationMessages.find(
      (m) => m.id === parentMessageId
    );
    // Push it to ordered messages array
    conversationOrderedMessages.unshift(conversationMessage);
    // Call getMessagesForConversation again with parent message id and ordered messages as arguments
    return getMessagesForConversation(
      conversationMessages,
      conversationMessage.parentMessageId,
      conversationOrderedMessages
    );
  }
  // Return ordered messages array as final result
  return conversationOrderedMessages;
}

if (!process.server) {
  const copyButtonListener = (e) => {
    // check parent elements for `data-is-copy-button` attribute
    let el = e.target;
    while (el) {
      if (el.dataset.isCopyButton) {
        // get sibling code block text
        const codeBlock = el.parentElement.querySelector("code");
        if (!codeBlock) {
          return;
        }
        // copy text to clipboard
        navigator.clipboard.writeText(codeBlock.innerText);
        // find child element with class `copy-status`
        const copyStatus = el.querySelector(".copy-status");
        if (copyStatus) {
          // set text to "Copied"
          copyStatus.innerText = "Copied";
          setTimeout(() => {
            if (!copyStatus) {
              return;
            }
            // set text back to "Copy"
            copyStatus.innerText = "Copy";
          }, 3000);
        }
        return;
      }
      el = el.parentElement;
    }
  };

  onMounted(() => {
    window.addEventListener("resize", setChatContainerHeight);
    nextTick(() => {
      setChatContainerHeight();
    });
    // watch for button clicks with attribute `data-clipboard-text`
    document.addEventListener("click", copyButtonListener);
  });

  onUnmounted(() => {
    window.removeEventListener("resize", setChatContainerHeight);
    document.removeEventListener("click", copyButtonListener);
    stopProcessing();
  });

  // watch inputRows for change and call `setChatContainerHeight` to adjust height
  watch(inputRows, () => {
    nextTick(() => {
      setChatContainerHeight();
    });
  });

  watch(isClientDropdownOpen, () => {
    nextTick(() => {
      setChatContainerHeight();
    });
  });

  watch(currentConversationV2, (newData, oldData) => {
    if (currentConversationV2.value) {
      conversationData.value = currentConversationV2.value;
      nextTick(() => {
        scrollToBottom();
      });
    } else {
      conversationData.value = {};
      messages.value = [];
    }
    if (newData?.id !== oldData?.id) {
      if (currentConversationV2.value) {
        messages.value = currentConversationV2.value.messages;
      }
    }
  });

  watch(newConversationCounter, () => {
    conversationData.value = {};
    messages.value = [];
    suggestedResponses.value = [];
  });
}
</script>

<template>
  <client-only>
    <ClientSettings
      :is-open="isClientSettingsModalOpen"
      :set-is-open="setIsClientSettingsModalOpen"
      :client="clientSettingsModalClient"
      :preset-name="clientSettingsModalPresetName"
    />
  </client-only>
  <div class="flex flex-col flex-grow items-center relative">
    <!--suppress CssInvalidPropertyValue -->
    <div
      ref="messagesContainerElement"
      class="overflow-y-auto w-full rounded-sm pb-12 px-3"
      style="overflow: overlay"
    >
      <TransitionGroup name="messages">
        <div
          class="max-w-4xl w-full mx-auto message"
          v-for="(message, index) in messages"
          :key="index"
        >
          <div
            class="p-3 rounded-sm"
            :class="{
              'bg-white/10 shadow': message.role === 'bot',
            }"
          >
            <!-- role name -->
            <div class="text-xs text-white/50 mb-1">
              <template v-if="message.role === 'bot'">
                {{ "AI" }}
              </template>
              <template v-else-if="message.role === 'user'">
                {{ "User" }}
              </template>
              <template v-else>
                {{ message.role }}
              </template>
            </div>
            <!-- message text -->
            <div
              class="prose prose-sm prose-chatgpt break-words max-w-6xl"
              v-html="
                message.role === 'user'
                  ? parseMarkdown(message.content)
                  : parseMarkdown(message.content, true)
              "
            />
          </div>
        </div>
      </TransitionGroup>
      <div
        class="max-w-4xl w-full mx-auto message"
        v-if="renderingState.streaming"
      >
        <div class="p-3 rounded-sm bg-white/10 shadow">
          <div class="text-xs text-white/50 mb-1">AI</div>

          <div
            class="prose prose-sm prose-chatgpt break-words max-w-6xl"
            v-html="renderingState.someText"
          ></div>
        </div>
      </div>
    </div>
    <div
      ref="inputContainerElement"
      class="mx-auto w-full max-w-4xl px-3 xl:px-0 flex flex-row absolute left-0 right-0 mb-7 sm:mb-0 z-10"
    >
      <div
        class="relative flex flex-row w-full justify-center items-stretch rounded shadow"
      >
        <div
          ref="chatButtonsContainerElement"
          class="flex gap-2 mb-3 items-stretch justify-center absolute bottom-full"
          :class="{ 'w-full': !processingController }"
        >
          <button
            v-if="processingController"
            @click="stopProcessing"
            class="flex-1 py-2 px-5 bg-white/10 text-slate-300 text-sm shadow rounded transition duration-300 ease-in-out hover:bg-white/20"
          >
            Stop
          </button>
          <button
            v-for="response in suggestedResponses"
            :key="response"
            @click="sendMessageToTrainedQa(response)"
            class="flex-1 py-2 px-3 bg-white/10 text-slate-300 text-sm shadow rounded transition duration-300 ease-in-out hover:bg-white/20"
          >
            {{ response }}
          </button>
        </div>
        <Transition name="slide-from-bottom">
          <ClientDropdown
            v-if="isClientDropdownOpen"
            :preset-name="activePresetNameToUse"
            :set-client-to-use="setActivePresetName"
            :set-is-client-settings-modal-open="setIsClientSettingsModalOpen"
            :can-change-preset="canChangePreset"
          />
        </Transition>
        <button
          @click="isClientDropdownOpen = !isClientDropdownOpen"
          class="flex items-center w-10 h-10 my-auto ml-2 justify-center absolute left-0 top-0 bottom-0 z-10"
        >
          <Transition name="fade" mode="out-in">
            <GPTIcon
              v-if="
                activePresetNameToUse === 'chatgpt' ||
                activePresetToUse?.client === 'chatgpt'
              "
              class="w-10 h-10 p-2 block transition duration-300 ease-in-out rounded-lg hover:bg-black/30 cursor-pointer hover:shadow"
              :class="{
                'bg-black/30 shadow': isClientDropdownOpen,
              }"
            />
            <GPTIcon
              v-else-if="
                activePresetNameToUse === 'chatgpt-browser' ||
                activePresetToUse?.client === 'chatgpt-browser'
              "
              class="w-10 h-10 p-2 text-[#6ea194] block transition duration-300 ease-in-out rounded-lg hover:bg-black/30 cursor-pointer hover:shadow"
              :class="{
                'bg-black/30 shadow': isClientDropdownOpen,
              }"
            />
          </Transition>
        </button>
        <textarea
          ref="inputTextElement"
          :rows="inputRows"
          v-model="message"
          @keydown.enter.exact="sendMessageToTrainedQa(message)"
          placeholder="Type your message here..."
          :disabled="!!processingController"
          class="py-4 pl-14 pr-14 rounded-l-sm text-slate-100 w-full bg-white/5 placeholder-white/40 focus:outline-none resize-none placeholder:truncate"
          :class="{
            'opacity-50 cursor-not-allowed': !!processingController,
          }"
        />
        <button
          v-if="
            !message &&
            regenerateData.canRegenerate &&
            typeof regenerateData.parentMessageId !== 'undefined' &&
            regenerateData.parentMessageId !== null &&
            !processingController
          "
          @click="
            sendMessageToTrainedQa(
              regenerateData.input,
              regenerateData.parentMessageId
            )
          "
          title="Regenerate"
          class="flex items-center flex-1 px-4 text-slate-300 bg-white/5 transition duration-300 ease-in-out hover:bg-white/10"
        >
          <Icon name="bx:bx-refresh" class="w-7 h-7" />
        </button>
        <button
          v-else
          @click="sendMessageToTrainedQa(message)"
          :disabled="!!processingController"
          class="flex items-center flex-1 px-4 text-slate-300 rounded-r-sm bg-white/5 transition duration-300 ease-in-out"
          :class="{
            'opacity-50 cursor-not-allowed': !!processingController,
            'hover:bg-white/10': !processingController,
          }"
        >
          <Icon class="w-5 h-5" name="bx:bxs-send" />
        </button>
      </div>
    </div>
  </div>
</template>

<style>
.messages-move, /* apply transition to moving elements */
.messages-enter-active {
  transition: all 0.3s ease;
}
.messages-enter-from {
  opacity: 0;
  transform: translateY(0);
}
/* ensure leaving items are taken out of layout flow so that moving
   animations can be calculated correctly. */
.messages-leave-active {
  position: absolute;
  opacity: 0;
}

.slide-from-bottom-enter-active,
.slide-from-bottom-leave-active {
  transition: all 0.3s ease;
}
.slide-from-bottom-enter-from,
.slide-from-bottom-leave-to {
  transform: translateY(30px);
  opacity: 0;
}

.message {
  -webkit-transform: matrix(1, 0, 0, 1, 0, 0.01);
}

.prose pre {
  @apply whitespace-pre-wrap;
}

.prose pre code {
  background-color: transparent;
  @apply text-xs;
}

.prose pre code .hljs-comment {
  @apply text-slate-500;
}

.prose p {
  word-break: break-word;
}

/* Getting rid of the main default styling of the range input */
input[type="range"] {
  -webkit-appearance: none;
}

input[type="range"]:focus {
  outline: none;
}

/* Styling the track */
input[type="range"]::-webkit-slider-runnable-track {
  @apply h-1 bg-white/10 rounded w-full;
}
input[type="range"]::-moz-range-track {
  @apply h-1 bg-white/10 rounded w-full;
}

/* Styling the thumb */
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  @apply w-4 h-4 bg-slate-300 rounded-full -m-[0.5em];
}

input[type="range"]::-moz-range-thumb {
  @apply w-4 h-4 bg-slate-300 rounded-full;
}

iframe {
  @apply bg-slate-100;
}
</style>
