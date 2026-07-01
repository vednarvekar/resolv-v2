import inquirer from "inquirer";
import chalk from "chalk";

export async function selectFromList<T extends string>(
  items: T[],
  label: (item: T) => string,
  promptLabel = "Select:"
): Promise<T> {
  const { choice } = await inquirer.prompt([
    {
      type: "select",
      name: "choice",
      message: promptLabel,
      choices: items.map((item) => ({ name: label(item), value: item })),
    },
  ]);
  return choice;
}

export function dimDescription(label: string, description: string): string {
  return `${label} ${chalk.dim(description)}`;
}
