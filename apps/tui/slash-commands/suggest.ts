const commands = [
  "/config",
  "/dna",
  "/help",
  "/exit"
];

const rl = readline.createInterface({
  input,
  output,
  prompt,
  completer: (line) => {
    const hits = commands.filter(cmd =>
      cmd.startsWith(line)
    );

    return [hits.length ? hits : commands, line];
  }
});