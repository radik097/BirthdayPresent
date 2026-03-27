declare module "adm-zip" {
  class AdmZip {
    constructor(filePath?: string);
    getEntries(): Array<{
      entryName: string;
      isDirectory: boolean;
      getData(): Buffer;
    }>;
    addLocalFolder(localPath: string): void;
    writeZip(targetPath: string): void;
  }

  export default AdmZip;
}
