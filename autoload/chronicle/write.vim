" =============================================================================
" File        : write.vim
" Author      : yukimemi
" Last Change : 2024/06/30 22:03:27.
" =============================================================================

function! chronicle#write#list() abort
  call denops#plugin#wait('chronicle')
  return denops#request('chronicle', 'listWrite', [])
endfunction

function! chronicle#write#open() abort
  call denops#plugin#wait('chronicle')
  return denops#notify('chronicle', 'open', [g:chronicle_write_path])
endfunction

