export const BOT_CONTENT = {
  WELCOME: {
    message: "Hi there! 👋 How can I help you with coding today?",
    buttons: [
      { label: "Explore Courses", value: "explore courses" },
      { label: "Find Challenges", value: "find challenges" },
      { label: "Show Coding Tips", value: "coding tips" },
      { label: "Talk to Agent", value: "talk to agent" }
    ],
    options: []
  },
  AGENT_UNAVAILABLE_FORM: {
    message: "No agents are currently available. Please leave your contact details and we'll get back to you.",
    form: {
      fields: [
        { label: "Name", name: "name", type: "text", required: true },
        { label: "Email", name: "email", type: "email", required: true },
        { label: "Phone", name: "phone", type: "tel", required: false },
        { label: "Message", name: "message", type: "textarea", required: false }
      ],
      submitLabel: "Submit"
    },
    buttons: [],
    options: []
  },
  EXPLORE_COURSES: {
    message: "Which course would you like to explore?",
    options: [
      { label: "JavaScript Basics", value: "js_basics" },
      { label: "Python for Beginners", value: "python_beginners" },
      { label: "React Essentials", value: "react_essentials" }
    ],
    buttons: [
      { label: "Find Challenges", value: "find challenges" },
      { label: "Show Coding Tips", value: "coding tips" }
    ]
  },
  FIND_CHALLENGES: {
    message: "Which coding challenge would you like to try?",
    options: [
      { label: "FizzBuzz", value: "fizzbuzz" },
      { label: "Palindrome Checker", value: "palindrome" },
      { label: "Prime Numbers", value: "prime_numbers" }
    ],
    buttons: [
      { label: "Explore Courses", value: "explore courses" },
      { label: "Show Coding Tips", value: "coding tips" }
    ]
  },
  CODING_TIPS: {
    message: "Tip: Break big problems into small steps and test as you go!",
    options: [],
    buttons: [
      { label: "Explore Courses", value: "explore courses" },
      { label: "Find Challenges", value: "find challenges" }
    ]
  },
  TALK_TO_AGENT: {
    message: "Connecting you to a human agent...",
    options: [],
    buttons: []
  },
  CONFUSED: {
    message: "I'm not sure what you mean. Would you like to talk to a human agent?",
    options: [],
    buttons: [
      { label: "Talk to Agent", value: "talk to agent" }
    ]
  },
  EXIT_CHAT: {
    message: "You've been disconnected from the agent. You're now chatting with our AI assistant 🤖🤖.",
    buttons: [
      { label: "Explore Courses", value: "explore courses" },
      { label: "Talk to Agent", value: "talk to agent" }
    ],
    options: []
  }
};
    