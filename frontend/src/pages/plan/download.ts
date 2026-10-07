/** Téléchargement d'un fichier servi par l'API (équivalent d'un <a href download>). */
export function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
