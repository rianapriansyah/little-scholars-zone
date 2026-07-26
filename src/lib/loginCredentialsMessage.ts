export function buildLoginCredentialsMessage(name: string, email: string, password: string): string {
  const loginUrl = `${window.location.origin}/login`
  return [
    `Hai ${name},`,
    ``,
    `Berikut detail login Little Scholars Zone Anda:`,
    ``,
    `Email: ${email}`,
    `Kata Sandi: ${password}`,
    ``,
    `Masuk di sini: ${loginUrl}`,
  ].join('\n')
}
