if exists('g:loaded_chronicle')
  finish
endif
let g:loaded_chronicle = 1

command! OpenChronicleRead call chronicle#read#list()
command! OpenChronicleWrite call chronicle#write#list()

