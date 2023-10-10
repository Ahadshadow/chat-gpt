export const useConversationsStore = defineStore("conversationsStore", () => {
  const newConversationCounter = ref(0);
  const conversations = useLocalStorage("conversations/v1", {});
  const conversationsV2 = useLocalStorage("conversations/v2", [{}]);
  const selectedConversation = useLocalStorage("selectedConversation/v2", null);
  const currentConversationIdV2 = ref({});
  const currentConversationId = ref("");
  const processingController = ref(null);

  const currentConversation = computed(() => {
    if (!currentConversationId.value) {
      return null;
    }
    // console.log("conversations", conversations);
    return conversations.value[currentConversationId.value] || null;
  });

  const currentConversationV2 = computed(() => {
    if (!selectedConversation.value) {
      return null;
    }
    const parsedSelectedConversation = JSON.parse(selectedConversation.value);
    return conversationsV2.value[parsedSelectedConversation.id] || null;
  });

  const conversationTitle = computed(
    () => currentConversation.value?.name || "New Chat"
  );

  function saveConversation(conversation) {
    selectedConversation.value = JSON.stringify(conversation);
  }

  function saveConversationHistory(conversations) {
    conversationsV2.value = conversations;
  }

  function updateConversation(
    id,
    updatedConversationData,
    messages,
    activePresetName,
    activePreset,
    content = ""
  ) {
    currentConversationId.value = id;
    const conversation = conversations.value[id];
    if (conversation) {
      conversation.data = updatedConversationData;
      conversation.messages = messages;
      conversation.updatedAt = Date.now();
      return;
    }
    conversations.value[id] = {
      id,
      data: updatedConversationData,
      role: "user",
      content: content,
      title: updatedConversationData.title || "New Chat",
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activePresetName,
      activePreset,
    };
  }

  function startNewConversation() {
    if (processingController.value) {
      return;
    }
    // this counter is really only meant for watcher to trigger updates
    newConversationCounter.value += 1;
    currentConversationId.value = "";
  }

  function setCurrentConversationId(id) {
    if (processingController.value) {
      return;
    }
    let selectedConver = conversationsV2.value.find((item) => item.id === id);
    currentConversationId.value = id;
    selectedConversation.value = JSON.stringify(selectedConver);
    // localStorage.setItem(
    //   "selectedConversation/v2",
    //   JSON.stringify(selectedConver)
    // );
  }

  function deleteConversation(id) {
    if (processingController.value) {
      return;
    }
    delete conversations.value[id];
    startNewConversation();
  }

  function clearConversations() {
    if (processingController.value) {
      return;
    }
    conversations.value = {};
    startNewConversation();
  }

  function updateConversationTitle(id, title) {
    const conversation = conversations.value[id];
    if (conversation) {
      conversation.title = title.trim();
    }
  }

  return {
    processingController,
    newConversationCounter,
    conversations,
    currentConversationId,
    currentConversation,
    conversationTitle,
    updateConversation,
    startNewConversation,
    setCurrentConversationId,
    deleteConversation,
    clearConversations,
    updateConversationTitle,
    selectedConversation,
    saveConversation,
    saveConversationHistory,
    conversationsV2,
    currentConversationV2,
    currentConversationIdV2,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useConversationsStore, import.meta.hot)
  );
}
