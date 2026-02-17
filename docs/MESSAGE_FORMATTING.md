# Message Formatting Guide

This guide describes the markdown-like formatting available for messages in the chat application.

## Basic Text Formatting

### Bold
Use single asterisks to make text bold:
```
*This text is bold*
```
Result: **This text is bold**

### Italics
Use double asterisks for italic text:
```
**This text is italic**
```
Result: *This text is italic*

### Bold Italics
Use triple asterisks for both bold and italic:
```
***This text is bold and italic***
```
Result: ***This text is bold and italic***

## Code Formatting

### Inline Code
Use single backticks for inline code:
```
Use the `console.log()` function to debug
```
Result: Use the `console.log()` function to debug

### Code Blocks
Use triple backticks for multi-line code blocks:
````
```
function example() {
  return "Hello World";
}
```
````

You can also specify a language for syntax highlighting:
````
```javascript
function example() {
  return "Hello World";
}
```
````

## Special Formatting

### Strikethrough (Crossout)
Use double tildes for strikethrough text:
```
~~This text is crossed out~~
```
Result: ~~This text is crossed out~~

### Spoilers
Use double pipes for spoiler text (click to reveal):
```
||This is a spoiler||
```
Result: Spoiler text that's hidden until clicked

### Quotes
Use `>` at the start of a line for quotes:
```
> This is a quoted text
```
Result: 
> This is a quoted text

## Additional Features

### Mentions
Mention users with @:
```
@username
```
The mention will be highlighted, and if it's your username, it will be specially highlighted.

### Custom Emojis
Use custom server emojis with colons:
```
:emojiname:
```

## Combining Formats

You can combine different formats (except within code blocks):
```
*Bold text with **italic inside*** and ~~strikethrough~~
```

## Notes

- Code blocks and inline code preserve all characters exactly as typed
- Spoilers can be clicked to reveal the hidden text
- Quotes work at the line level
- All formatting respects mentions and custom emojis
- Formatting syntax characters within code are not processed

## Implementation Details

The formatting is processed in the following order:
1. Code blocks (```)
2. Inline code (`)
3. Spoilers (||)
4. Strikethrough (~~)
5. Bold italics (***)
6. Italics (**)
7. Bold (*)
8. Quotes (>)

This order ensures that more specific patterns are matched before more general ones.
