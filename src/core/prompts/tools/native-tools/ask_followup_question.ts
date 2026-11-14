import type OpenAI from "openai"

const ASK_FOLLOWUP_QUESTION_DESCRIPTION = `Ask the user a question to gather additional information needed to complete the task. Use when you need clarification or more details to proceed effectively.

Parameters:
- question: (required) A clear, specific question addressing the information needed
- follow_up: (required) A list of 2-4 suggested answers. Suggestions must be complete, actionable answers without placeholders. Always set mode to null. Selecting an answer never switches mode or provider.

Example: Asking for file path
{ "question": "What is the path to the frontend-config.json file?", "follow_up": [{ "text": "./src/frontend-config.json", "mode": null }, { "text": "./config/frontend-config.json", "mode": null }, { "text": "./frontend-config.json", "mode": null }] }`

const QUESTION_PARAMETER_DESCRIPTION = `Clear, specific question that captures the missing information you need`

const FOLLOW_UP_PARAMETER_DESCRIPTION = `Required list of 2-4 suggested responses; each suggestion must be a complete, actionable answer. Always set mode to null; selecting an answer never switches mode or provider.`

const FOLLOW_UP_TEXT_DESCRIPTION = `Suggested answer the user can pick`

const FOLLOW_UP_MODE_DESCRIPTION = `Must be null. Selecting a suggestion never switches mode or provider.`

export default {
	type: "function",
	function: {
		name: "ask_followup_question",
		description: ASK_FOLLOWUP_QUESTION_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description: QUESTION_PARAMETER_DESCRIPTION,
				},
				follow_up: {
					type: "array",
					description: FOLLOW_UP_PARAMETER_DESCRIPTION,
					items: {
						type: "object",
						properties: {
							text: {
								type: "string",
								description: FOLLOW_UP_TEXT_DESCRIPTION,
							},
							mode: {
								type: ["string", "null"],
								description: FOLLOW_UP_MODE_DESCRIPTION,
							},
						},
						required: ["text", "mode"],
						additionalProperties: false,
					},
					minItems: 1,
					maxItems: 4,
				},
			},
			required: ["question", "follow_up"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
