import asyncio
from typing import Annotated
import os
from typing_extensions import TypedDict

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from langchain.chat_models import init_chat_model
from langchain_mcp_adapters.tools import load_mcp_tools

from langgraph.graph import StateGraph, START
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition, create_react_agent


knowledge_args = knowledge_args = [
    "run", 
    "-i", 
    "--rm",
    "--network=graphrag-knowledge_mcp_net",  # Use the network name from docker compose
    "graphrag-knowledge-mcp",   # Use the image name from docker-compose.yml
    "node", "dist/index.js"
]
try:
    with open("prompt.txt", "r") as f:
        PROMPT = f.read()
except FileNotFoundError:
    PROMPT = """You are a helpful assistant that can answer questions about the knowledge base.
    Use the tools provided to fetch information from the knowledge base.
    If you don't know the answer, say "I don't know"."""
## Works:
fetch_args = ["run", "-i", "--rm", "mcp/fetch"]

def create_chatbot(tools):
    llm = init_chat_model(
        model = os.getenv("LLM_API_MODEL", "anthropic:claude-4-sonnet-latest"),
        base_url = os.getenv("LLM_API_URL", "http://localhost:8080"),
        api_key = os.getenv("LLM_API_KEY", "test"),
    )
    agent = create_react_agent(
        model=llm,
        tools=tools,
        prompt=PROMPT,
        checkpointer=MemorySaver()
    )
    return agent

async def invoke_graph(graph):
    messages = []
    config = {"configurable": {"thread_id": "1"}}
    while True:
        user_input = input("User: ")
        if user_input.lower() == "quit":
            print("Exiting...")
            break
        messages.append({"role": "user", "content": user_input})
        async for event in graph.astream({"messages": messages}, config=config, stream_mode="values"):
            event["messages"][-1].pretty_print()

async def main():
    async with stdio_client(
        StdioServerParameters(command="docker", args=knowledge_args)
    ) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            # List available resources
            tools = await load_mcp_tools(session)
            graph = create_chatbot(tools)
            # Run the graph
            await invoke_graph(graph)

asyncio.run(main())
