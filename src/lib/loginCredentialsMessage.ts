export function buildLoginCredentialsMessage(name: string, email: string, password: string): string {
  const loginUrl = `${window.location.origin}/login`
  return [
    `Hi ${name},`,
    ``,
    `Here are your Little Scholars Zone login details:`,
    ``,
    `Email: ${email}`,
    `Password: ${password}`,
    ``,
    `Sign in here: ${loginUrl}`,
  ].join('\n')
}
