// kilocode_change - new file
import { getMcpServersSection } from "../mcp-servers"
import type { McpHub } from "../../../../services/mcp/McpHub"

describe("compact MCP schema serialization", () => {
	const schema = {
		type: "object",
		properties: {
			query: { type: "string", description: "Preserve  repeated spaces and 中文", minLength: 1 },
			options: { anyOf: [{ type: "null" }, { type: "array", items: { enum: ["a", "b"] } }] },
		},
		required: ["query"],
		additionalProperties: false,
	}
	const hub = {
		getServers: () => [
			{
				name: "schema-test",
				status: "connected",
				config: "{}",
				instructions: "Keep server instructions",
				tools: [
					{ name: "query", description: "Keep tool description", inputSchema: schema },
					{ name: "hidden", description: "hidden", inputSchema: schema, enabledForPrompt: false },
				],
				resources: [{ uri: "test://data", name: "Data", description: "Keep resource" }],
				resourceTemplates: [{ uriTemplate: "test://{id}", name: "Item", description: "Keep template" }],
			},
		],
	} as unknown as McpHub

	it("preserves every schema value while eliminating presentation whitespace", async () => {
		const result = await getMcpServersSection(hub)
		const compact = JSON.stringify(schema)
		expect(result).toContain(compact)
		expect(JSON.parse(result.slice(result.indexOf(compact), result.indexOf(compact) + compact.length))).toEqual(
			schema,
		)
		expect(compact.length).toBeLessThan(JSON.stringify(schema, null, 2).length)
		for (const value of ["Keep server instructions", "Keep tool description", "Keep resource", "Keep template"]) {
			expect(result).toContain(value)
		}
		expect(result).not.toContain("- hidden:")
	})

	it("keeps native catalog exclusion and server resources intact", async () => {
		const result = await getMcpServersSection(hub, undefined, false, false)
		expect(result).not.toContain("Input Schema:")
		expect(result).not.toContain("Keep tool description")
		expect(result).toContain("Keep server instructions")
		expect(result).toContain("test://data")
		expect(result).toContain("mcp_{server_name}_{tool_name}")
	})
})
