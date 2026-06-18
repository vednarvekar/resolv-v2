// ============================================================
// resolv — orchestrator-agent/tool-registry.ts
// A thin wrapper around ToolDefinition[] that the agent loop uses to look
// up a tool by name when the model asks to call one. Kept deliberately
// dumb — it doesn't know what tools exist, callers register them.
// ============================================================

import type { ToolDefinition } from "../core/types.js";

export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>()

    register(tool: ToolDefinition): void {
        if(this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name} is already registered"`)
        }
        this.tools.set(tool.name, tool)
    }

    registerAll(tools: ToolDefinition[]): void {
        for(const tool of tools) this.register(tool);
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }
 
    list(): ToolDefinition[] {
        return [...this.tools.values()];
    }
 
    has(name: string): boolean {
        return this.tools.has(name);
    }
}