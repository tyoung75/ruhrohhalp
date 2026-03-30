declare module "@anthropic-ai/sdk" {
  const Anthropic: any;
  export default Anthropic;
}

declare module "@octokit/rest" {
  export const Octokit: any;
}

declare module "googleapis" {
  export const google: any;
}
