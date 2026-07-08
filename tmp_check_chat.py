import subprocess, sys
result = subprocess.run(
    ["docker", "exec", sys.argv[1], "sh", "-c", "curl -s http://localhost:8000/ 2>/dev/null"],
    capture_output=True, text=True
)
html = result.stdout
terms = ["chatBtn", "chatModal", "chat-button", "envelope", "sobre", "chat_btn", "chat-btn"]
for t in terms:
    if t in html:
        print(f"FOUND: {t}")
        break
else:
    print("NOT FOUND: none of the chat terms in HTML")
    # Show a snippet around the auth section
    idx = html.find("authSection")
    if idx > 0:
        print("Context around authSection:")
        print(html[max(0,idx-200):idx+500])
