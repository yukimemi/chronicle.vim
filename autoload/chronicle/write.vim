" =============================================================================
" File        : write.vim
" Author      : yukimemi
" Last Change : 2024/05/25 20:59:09.
" =============================================================================

function! chronicle#write#list() abort
  call denops#plugin#wait('chronicle')
  return denops#request('chronicle', 'listWrite', [])
endfunction

