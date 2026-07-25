from pathlib import Path

path = Path('src/dist/extension.js')
text = path.read_text()
changed = False

old_language = 'Vz("","","","commit",{language:"en",localRulesToggleState:void 0,globalRulesToggleState:void 0})'
new_language = 'Vz("","","","commit",{language:"zh-CN",localRulesToggleState:void 0,globalRulesToggleState:void 0})'
if old_language in text:
    text = text.replace(old_language, new_language, 1)
    changed = True
elif new_language not in text:
    raise SystemExit('commit custom-instructions language pattern not found')

old_prompt = '- ONLY Generate a clean conventional commit message as specified below\n\n\\${gitContext}'
new_prompt = '- ONLY Generate a clean conventional commit message as specified below\n- Use Simplified Chinese for the description and body by default, while keeping the Conventional Commit type and optional scope in English\n\n\\${gitContext}'
if old_prompt in text:
    text = text.replace(old_prompt, new_prompt, 1)
    changed = True
elif new_prompt not in text:
    raise SystemExit('commit support prompt pattern not found')

if changed:
    path.write_text(text)

verified = path.read_text()
print('dist_commit_language_zh_cn', new_language in verified)
print('dist_commit_prompt_simplified_chinese', 'Use Simplified Chinese for the description and body by default' in verified)
