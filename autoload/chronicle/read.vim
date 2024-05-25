" =============================================================================
" File        : read.vim
" Author      : yukimemi
" Last Change : 2024/05/25 20:58:56.
" =============================================================================

function! chronicle#read#list() abort
  call denops#plugin#wait('chronicle')
  return denops#request('chronicle', 'listRead', [])
endfunction

